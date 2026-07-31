package relay

import (
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

const (
	persistenceFirstSubmitRecoveryDelay = 5 * time.Minute
	persistenceFirstErrorBodyReadLimit  = 64 << 10
)

type persistenceFirstSubmission struct {
	task        *model.Task
	adaptor     channel.PersistenceFirstTaskAdaptor
	pendingData []byte
}

func beginPersistenceFirstSubmission(
	c *gin.Context,
	info *relaycommon.RelayInfo,
	platform constant.TaskPlatform,
	adaptor channel.PersistenceFirstTaskAdaptor,
) (*persistenceFirstSubmission, *TaskSubmitResult, *dto.TaskError) {
	result := &TaskSubmitResult{
		Platform:         platform,
		PersistenceFirst: true,
	}
	if info == nil || info.TaskRelayInfo == nil || info.PublicTaskID == "" {
		return nil, result, service.TaskErrorWrapperLocal(fmt.Errorf("public task id is empty"), "missing_public_task_id", http.StatusInternalServerError)
	}
	pendingData, err := adaptor.BuildPendingTaskData(info)
	if err != nil {
		return nil, result, service.TaskErrorWrapperLocal(err, "build_pending_task_failed", http.StatusInternalServerError)
	}

	task := model.InitTask(platform, info)
	submissionKey := info.PublicTaskID
	task.SubmissionKey = &submissionKey
	task.Status = model.TaskStatusSubmitting
	task.Progress = "0%"
	task.Action = info.Action
	// SUBMITTING is deliberately persisted without quota ownership. The request
	// BillingSession remains the sole refund owner until the arm CAS below wins.
	task.Quota = 0
	task.Data = pendingData
	task.PrivateData.BillingSource = info.BillingSource
	task.PrivateData.SubscriptionId = info.SubscriptionId
	task.PrivateData.TokenId = info.TokenId
	task.PrivateData.NodeName = common.NodeName
	task.PrivateData.BillingContext = &model.TaskBillingContext{
		ModelPrice:      info.PriceData.ModelPrice,
		GroupRatio:      info.PriceData.GroupRatioInfo.GroupRatio,
		ModelRatio:      info.PriceData.ModelRatio,
		OtherRatios:     info.PriceData.OtherRatios(),
		OriginModelName: info.OriginModelName,
		PerCallBilling:  common.StringsContains(constant.TaskPricePatches, info.OriginModelName) || info.PriceData.UsePrice,
	}

	if err := task.Insert(); err != nil {
		return nil, result, service.TaskErrorWrapperLocal(err, "persist_task_failed", http.StatusInternalServerError)
	}

	result.DurableTask = task
	reservedQuota := 0
	if info.Billing != nil {
		reservedQuota = info.Billing.GetPreConsumedQuota()
	}
	result.Quota = reservedQuota

	task.Status = model.TaskStatusSubmitUnknown
	task.Quota = reservedQuota
	task.SubmitRecoveryAt = time.Now().Add(persistenceFirstSubmitRecoveryDelay).Unix()
	won, armErr := task.UpdateWithStatusAndQuota(model.TaskStatusSubmitting, 0)
	if armErr != nil || !won {
		reason := "failed to arm durable submission before upstream request"
		aborted := abortPersistenceFirstBeforeUpstream(c, task, reason)
		result.DurableQuotaOwned = !aborted && reservedQuota > 0
		if armErr != nil {
			return nil, result, service.TaskErrorWrapperLocal(armErr, "arm_task_recovery_failed", http.StatusInternalServerError)
		}
		return nil, result, service.TaskErrorWrapperLocal(fmt.Errorf("durable task state changed before submit"), "arm_task_recovery_conflict", http.StatusConflict)
	}
	result.DurableQuotaOwned = reservedQuota > 0

	// The arm CAS transferred the reservation marker to Task. Settling at the
	// exact reserved amount now only closes the in-memory BillingSession.
	if info.Billing != nil {
		if err := info.Billing.Settle(reservedQuota); err != nil {
			aborted := abortPersistenceFirstBeforeUpstream(c, task, "failed to transfer billing reservation to durable task")
			if aborted {
				result.DurableQuotaOwned = false
			}
			return nil, result, service.TaskErrorWrapperLocal(err, "persist_task_billing_failed", http.StatusInternalServerError)
		}
	}

	// Record the reserved consumption exactly once after the durable task and
	// recovery state are committed. Terminal failure writes the matching refund
	// through the existing task billing path.
	service.LogTaskConsumption(c, info)

	return &persistenceFirstSubmission{
		task:        task,
		adaptor:     adaptor,
		pendingData: pendingData,
	}, result, nil
}

func abortPersistenceFirstBeforeUpstream(c *gin.Context, task *model.Task, reason string) bool {
	if task == nil || task.SubmissionKey == nil {
		return false
	}
	for attempt := 0; attempt < 3; attempt++ {
		persisted, exists, err := model.GetBySubmissionKey(*task.SubmissionKey)
		if err != nil {
			logger.LogError(c, fmt.Sprintf("failed to inspect submission abort state for task %s: %s", task.TaskID, err.Error()))
			return false
		}
		if !exists {
			return false
		}
		if persisted.Status == model.TaskStatusFailure && persisted.Quota == 0 {
			*task = *persisted
			return true
		}
		if persisted.Status != model.TaskStatusSubmitting && persisted.Status != model.TaskStatusSubmitUnknown {
			return false
		}

		fromStatus := persisted.Status
		fromQuota := persisted.Quota
		persisted.Status = model.TaskStatusFailure
		persisted.Progress = taskcommon.ProgressComplete
		persisted.FinishTime = time.Now().Unix()
		persisted.SubmitRecoveryAt = 0
		persisted.FailReason = reason
		persisted.Quota = 0
		won, updateErr := persisted.UpdateWithStatusAndQuota(fromStatus, fromQuota)
		if updateErr != nil {
			logger.LogError(c, fmt.Sprintf("failed to abort submission before upstream for task %s: %s", task.TaskID, updateErr.Error()))
			continue
		}
		if won {
			*task = *persisted
			return true
		}
	}
	return false
}

func buildPersistenceFirstPublicData(
	submission *persistenceFirstSubmission,
	info *relaycommon.RelayInfo,
	upstreamData []byte,
) ([]byte, error) {
	return submission.adaptor.BuildPublicTaskData(info, upstreamData)
}

func adjustPersistenceFirstQuota(c *gin.Context, submission *persistenceFirstSubmission, finalQuota int, clamp *common.QuotaClamp) bool {
	task := submission.task
	if finalQuota == task.Quota {
		return true
	}
	if finalQuota <= 0 {
		if !service.ClaimAndRefundTaskQuota(c.Request.Context(), task, "submit response adjustment") {
			return false
		}
		fresh, exists, err := model.GetBySubmissionKey(*task.SubmissionKey)
		if err != nil || !exists || fresh.Status != model.TaskStatusSubmitUnknown || fresh.Quota != 0 {
			return false
		}
		*task = *fresh
		return true
	}
	return service.RecalculateTaskQuotaWhileStatus(
		c.Request.Context(),
		task,
		finalQuota,
		model.TaskStatusSubmitUnknown,
		"submit response adjustment",
		clamp,
	)
}

func finishPersistenceFirstSubmission(submission *persistenceFirstSubmission, upstreamTaskID string, publicData []byte) (bool, error) {
	task := submission.task
	expectedQuota := task.Quota
	task.PrivateData.UpstreamTaskID = upstreamTaskID
	task.Data = publicData
	task.Status = model.TaskStatusSubmitted
	task.Progress = taskcommon.ProgressSubmitted
	task.SubmitRecoveryAt = 0
	return task.UpdateWithStatusAndQuota(model.TaskStatusSubmitUnknown, expectedQuota)
}

func failPersistenceFirstSubmission(c *gin.Context, submission *persistenceFirstSubmission, reason string) bool {
	task := submission.task
	oldStatus := task.Status
	oldQuota := task.Quota
	task.Status = model.TaskStatusFailure
	task.Progress = taskcommon.ProgressComplete
	task.FinishTime = time.Now().Unix()
	task.SubmitRecoveryAt = 0
	task.FailReason = common.LocalLogPreview(reason)
	won, err := task.UpdateWithStatusAndQuota(oldStatus, oldQuota)
	if err != nil {
		logger.LogError(c, fmt.Sprintf("failed to persist explicit submit failure for task %s: %s", task.TaskID, err.Error()))
		return false
	}
	if !won {
		logger.LogWarn(c, fmt.Sprintf("submit failure CAS lost for task %s; keep it recoverable", task.TaskID))
		return false
	}
	if task.Quota != 0 {
		service.ClaimAndRefundTaskQuota(c.Request.Context(), task, task.FailReason)
	}
	return true
}

func persistenceFirstStatusIsUncertain(statusCode int) bool {
	return statusCode == http.StatusRequestTimeout ||
		statusCode == http.StatusConflict ||
		statusCode == http.StatusTooEarly ||
		statusCode >= http.StatusInternalServerError
}

func writePersistenceFirstAccepted(c *gin.Context, result *TaskSubmitResult, submission *persistenceFirstSubmission, reason string) {
	result.SubmissionUnknown = true
	if reason != "" {
		logger.LogWarn(c, fmt.Sprintf("task %s submit outcome is unknown and will be recovered by public id: %s", submission.task.TaskID, reason))
	}
	c.Header("Retry-After", fmt.Sprintf("%d", int(persistenceFirstSubmitRecoveryDelay.Seconds())))
	c.Data(http.StatusAccepted, "application/json; charset=utf-8", submission.pendingData)
}
