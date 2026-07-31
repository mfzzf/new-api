package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type taskPollingFetchAdaptor struct {
	mu           sync.Mutex
	taskIDs      []string
	fetched      chan string
	blockTaskID  string
	blockStarted chan struct{}
	releaseBlock chan struct{}
	blockOnce    sync.Once
}

type durableVideoPollingAdaptor struct {
	statusCode int
	body       []byte
	fetchedID  string
}

type sunoFailurePollingAdaptor struct {
	failReason string
}

func (a *sunoFailurePollingAdaptor) Init(_ *relaycommon.RelayInfo) {}

func (a *sunoFailurePollingAdaptor) FetchTask(_ string, _ string, body map[string]any, _ string) (*http.Response, error) {
	taskIDs, _ := body["ids"].([]string)
	items := make([]dto.SunoDataResponse, 0, len(taskIDs))
	for _, taskID := range taskIDs {
		items = append(items, dto.SunoDataResponse{
			TaskID:     taskID,
			Status:     string(model.TaskStatusFailure),
			FailReason: a.failReason,
			FinishTime: time.Now().Unix(),
		})
	}

	responseBody, err := common.Marshal(dto.TaskResponse[[]dto.SunoDataResponse]{
		Code: dto.TaskSuccessCode,
		Data: items,
	})
	if err != nil {
		return nil, err
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(responseBody)),
	}, nil
}

func (a *sunoFailurePollingAdaptor) ParseTaskResult([]byte) (*relaycommon.TaskInfo, error) {
	return nil, nil
}

func (a *sunoFailurePollingAdaptor) AdjustBillingOnComplete(_ *model.Task, _ *relaycommon.TaskInfo) int {
	return 0
}

func (a *taskPollingFetchAdaptor) Init(_ *relaycommon.RelayInfo) {}

func (a *taskPollingFetchAdaptor) FetchTask(_ string, _ string, body map[string]any, _ string) (*http.Response, error) {
	taskID, _ := body["task_id"].(string)
	if taskID == a.blockTaskID && a.releaseBlock != nil {
		a.blockOnce.Do(func() {
			if a.blockStarted != nil {
				close(a.blockStarted)
			}
		})
		<-a.releaseBlock
	}

	a.mu.Lock()
	a.taskIDs = append(a.taskIDs, taskID)
	a.mu.Unlock()
	if a.fetched != nil {
		select {
		case a.fetched <- taskID:
		default:
		}
	}

	response := dto.TaskResponse[model.Task]{
		Code: dto.TaskSuccessCode,
		Data: model.Task{
			TaskID:   taskID,
			Status:   model.TaskStatusInProgress,
			Progress: "30%",
		},
	}
	responseBody, err := common.Marshal(response)
	if err != nil {
		return nil, err
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(responseBody)),
	}, nil
}

func (a *taskPollingFetchAdaptor) ParseTaskResult([]byte) (*relaycommon.TaskInfo, error) {
	return &relaycommon.TaskInfo{Status: model.TaskStatusInProgress}, nil
}

func (a *taskPollingFetchAdaptor) AdjustBillingOnComplete(_ *model.Task, _ *relaycommon.TaskInfo) int {
	return 0
}

func (a *durableVideoPollingAdaptor) Init(_ *relaycommon.RelayInfo) {}

func (a *durableVideoPollingAdaptor) FetchTask(_ string, _ string, body map[string]any, _ string) (*http.Response, error) {
	a.fetchedID, _ = body["task_id"].(string)
	return &http.Response{
		StatusCode: a.statusCode,
		Body:       io.NopCloser(bytes.NewReader(a.body)),
	}, nil
}

func (a *durableVideoPollingAdaptor) ParseTaskResult(body []byte) (*relaycommon.TaskInfo, error) {
	var response struct {
		ID       string `json:"id"`
		TaskID   string `json:"task_id"`
		Status   string `json:"status"`
		Progress int    `json:"progress"`
	}
	if err := common.Unmarshal(body, &response); err != nil {
		return nil, err
	}
	taskID := response.ID
	if taskID == "" {
		taskID = response.TaskID
	}
	result := &relaycommon.TaskInfo{TaskID: taskID}
	switch response.Status {
	case "queued":
		result.Status = model.TaskStatusQueued
	case "processing":
		result.Status = model.TaskStatusInProgress
	case "completed":
		result.Status = model.TaskStatusSuccess
	case "failed":
		result.Status = model.TaskStatusFailure
		result.Reason = "upstream task failed"
	}
	if response.Progress > 0 && response.Progress < 100 {
		result.Progress = fmt.Sprintf("%d%%", response.Progress)
	}
	return result, nil
}

func (a *durableVideoPollingAdaptor) AdjustBillingOnComplete(_ *model.Task, _ *relaycommon.TaskInfo) int {
	return 0
}

func (a *durableVideoPollingAdaptor) BuildPublicPollingTaskData(task *model.Task, body []byte) ([]byte, error) {
	var response struct {
		Status   string `json:"status"`
		Progress int    `json:"progress"`
	}
	if err := common.Unmarshal(body, &response); err != nil {
		return nil, err
	}
	return common.Marshal(map[string]any{
		"id":       task.TaskID,
		"task_id":  task.TaskID,
		"model":    task.Properties.OriginModelName,
		"status":   response.Status,
		"progress": response.Progress,
	})
}

func (a *taskPollingFetchAdaptor) fetchCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.taskIDs)
}

func (a *taskPollingFetchAdaptor) fetchedTaskIDs() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.taskIDs...)
}

func seedTaskPollingChannel(t *testing.T, id int, disableSleep bool) {
	t.Helper()
	ch := &model.Channel{
		Id:     id,
		Type:   constant.ChannelTypeKling,
		Name:   "polling_channel",
		Key:    "sk-test",
		Status: common.ChannelStatusEnabled,
	}
	if disableSleep {
		ch.SetOtherSettings(dto.ChannelOtherSettings{DisableTaskPollingSleep: true})
	}
	require.NoError(t, model.DB.Create(ch).Error)
}

func seedPollingTask(t *testing.T, channelID int, publicID string, upstreamID string) *model.Task {
	t.Helper()
	task := &model.Task{
		TaskID:    publicID,
		Platform:  constant.TaskPlatform("kling"),
		UserId:    1,
		ChannelId: channelID,
		Action:    constant.TaskActionGenerate,
		Status:    model.TaskStatusInProgress,
		Progress:  "30%",
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
		PrivateData: model.TaskPrivateData{
			UpstreamTaskID: upstreamID,
		},
	}
	require.NoError(t, model.DB.Create(task).Error)
	return task
}

func seedSubmitUnknownVideoTask(t *testing.T, userID, channelID, quota, tokenID int, publicID string) *model.Task {
	t.Helper()
	submissionKey := publicID
	task := &model.Task{
		TaskID:           publicID,
		SubmissionKey:    &submissionKey,
		SubmitRecoveryAt: time.Now().Add(-time.Second).Unix(),
		Platform:         constant.TaskPlatform("sora"),
		UserId:           userID,
		Group:            "default",
		ChannelId:        channelID,
		Quota:            quota,
		Action:           constant.TaskActionGenerate,
		Status:           model.TaskStatusSubmitUnknown,
		Progress:         "0%",
		SubmitTime:       model.TaskRefundLegacyCutoff,
		CreatedAt:        time.Now().Unix(),
		UpdatedAt:        time.Now().Unix(),
		Properties: model.Properties{
			OriginModelName: "dreamto-video",
		},
		PrivateData: model.TaskPrivateData{
			BillingSource: BillingSourceWallet,
			TokenId:       tokenID,
		},
		Data: []byte(fmt.Sprintf(
			`{"id":%q,"task_id":%q,"model":"dreamto-video","status":"queued"}`,
			publicID,
			publicID,
		)),
	}
	require.NoError(t, model.DB.Create(task).Error)
	return task
}

func TestUpdateVideoTasksDefaultSleepWaitsBetweenTasks(t *testing.T) {
	truncate(t)

	const channelID = 101
	seedTaskPollingChannel(t, channelID, false)
	first := seedPollingTask(t, channelID, "task_public_1", "upstream_1")
	second := seedPollingTask(t, channelID, "task_public_2", "upstream_2")

	adaptor := &taskPollingFetchAdaptor{}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := UpdateVideoTasks(ctx, constant.TaskPlatform("kling"), map[int][]string{
		channelID: {
			first.GetUpstreamTaskID(),
			second.GetUpstreamTaskID(),
		},
	}, map[string]*model.Task{
		first.GetUpstreamTaskID():  first,
		second.GetUpstreamTaskID(): second,
	})

	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.Equal(t, 1, adaptor.fetchCount())
}

func TestUpdateVideoTasksCanSkipPollingSleepPerChannel(t *testing.T) {
	truncate(t)

	const channelID = 102
	seedTaskPollingChannel(t, channelID, true)
	first := seedPollingTask(t, channelID, "task_public_3", "upstream_3")
	second := seedPollingTask(t, channelID, "task_public_4", "upstream_4")

	adaptor := &taskPollingFetchAdaptor{}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	err := UpdateVideoTasks(ctx, constant.TaskPlatform("kling"), map[int][]string{
		channelID: {
			first.GetUpstreamTaskID(),
			second.GetUpstreamTaskID(),
		},
	}, map[string]*model.Task{
		first.GetUpstreamTaskID():  first,
		second.GetUpstreamTaskID(): second,
	})

	require.NoError(t, err)
	assert.Equal(t, 2, adaptor.fetchCount())
}

func TestUpdateVideoTasksDefaultSleepDoesNotBlockOtherChannels(t *testing.T) {
	truncate(t)

	const firstChannelID = 201
	const secondChannelID = 202
	seedTaskPollingChannel(t, firstChannelID, false)
	seedTaskPollingChannel(t, secondChannelID, false)
	firstChannelFirst := seedPollingTask(t, firstChannelID, "task_public_5", "upstream_a_1")
	firstChannelSecond := seedPollingTask(t, firstChannelID, "task_public_6", "upstream_a_2")
	secondChannelFirst := seedPollingTask(t, secondChannelID, "task_public_7", "upstream_b_1")
	secondChannelSecond := seedPollingTask(t, secondChannelID, "task_public_8", "upstream_b_2")

	adaptor := &taskPollingFetchAdaptor{}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := UpdateVideoTasks(ctx, constant.TaskPlatform("kling"), map[int][]string{
		firstChannelID: {
			firstChannelFirst.GetUpstreamTaskID(),
			firstChannelSecond.GetUpstreamTaskID(),
		},
		secondChannelID: {
			secondChannelFirst.GetUpstreamTaskID(),
			secondChannelSecond.GetUpstreamTaskID(),
		},
	}, map[string]*model.Task{
		firstChannelFirst.GetUpstreamTaskID():   firstChannelFirst,
		firstChannelSecond.GetUpstreamTaskID():  firstChannelSecond,
		secondChannelFirst.GetUpstreamTaskID():  secondChannelFirst,
		secondChannelSecond.GetUpstreamTaskID(): secondChannelSecond,
	})

	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.ElementsMatch(t, []string{"upstream_a_1", "upstream_b_1"}, adaptor.fetchedTaskIDs())
}

func TestUpdateVideoTasksSlowChannelDoesNotBlockOtherChannels(t *testing.T) {
	truncate(t)

	const slowChannelID = 251
	const fastChannelID = 252
	seedTaskPollingChannel(t, slowChannelID, false)
	seedTaskPollingChannel(t, fastChannelID, true)
	slowTask := seedPollingTask(t, slowChannelID, "task_public_slow", "upstream_slow_1")
	fastFirst := seedPollingTask(t, fastChannelID, "task_public_fast_1", "upstream_fast_parallel_1")
	fastSecond := seedPollingTask(t, fastChannelID, "task_public_fast_2", "upstream_fast_parallel_2")
	slowUpstreamID := slowTask.GetUpstreamTaskID()
	fastFirstUpstreamID := fastFirst.GetUpstreamTaskID()
	fastSecondUpstreamID := fastSecond.GetUpstreamTaskID()

	adaptor := &taskPollingFetchAdaptor{
		fetched:      make(chan string, 4),
		blockTaskID:  slowUpstreamID,
		blockStarted: make(chan struct{}),
		releaseBlock: make(chan struct{}),
	}
	var releaseOnce sync.Once
	releaseBlockedTask := func() {
		releaseOnce.Do(func() {
			close(adaptor.releaseBlock)
		})
	}
	t.Cleanup(releaseBlockedTask)
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })

	errCh := make(chan error, 1)
	gopool.Go(func() {
		errCh <- UpdateVideoTasks(context.Background(), constant.TaskPlatform("kling"), map[int][]string{
			slowChannelID: {
				slowUpstreamID,
			},
			fastChannelID: {
				fastFirstUpstreamID,
				fastSecondUpstreamID,
			},
		}, map[string]*model.Task{
			slowUpstreamID:       slowTask,
			fastFirstUpstreamID:  fastFirst,
			fastSecondUpstreamID: fastSecond,
		})
	})

	select {
	case <-adaptor.blockStarted:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("slow channel did not start blocking")
	}

	require.Eventually(t, func() bool {
		fetchedTaskIDs := adaptor.fetchedTaskIDs()
		return len(fetchedTaskIDs) == 2 &&
			fetchedTaskIDs[0] == fastFirstUpstreamID &&
			fetchedTaskIDs[1] == fastSecondUpstreamID
	}, 500*time.Millisecond, 10*time.Millisecond)

	releaseBlockedTask()
	require.NoError(t, <-errCh)
	assert.ElementsMatch(t, []string{
		slowUpstreamID,
		fastFirstUpstreamID,
		fastSecondUpstreamID,
	}, adaptor.fetchedTaskIDs())
}

func TestUpdateVideoTasksMixedChannelSleepSettings(t *testing.T) {
	truncate(t)

	const sleepyChannelID = 301
	const fastChannelID = 302
	seedTaskPollingChannel(t, sleepyChannelID, false)
	seedTaskPollingChannel(t, fastChannelID, true)
	sleepyFirst := seedPollingTask(t, sleepyChannelID, "task_public_9", "upstream_sleepy_1")
	sleepySecond := seedPollingTask(t, sleepyChannelID, "task_public_10", "upstream_sleepy_2")
	fastFirst := seedPollingTask(t, fastChannelID, "task_public_11", "upstream_fast_1")
	fastSecond := seedPollingTask(t, fastChannelID, "task_public_12", "upstream_fast_2")

	adaptor := &taskPollingFetchAdaptor{}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := UpdateVideoTasks(ctx, constant.TaskPlatform("kling"), map[int][]string{
		sleepyChannelID: {
			sleepyFirst.GetUpstreamTaskID(),
			sleepySecond.GetUpstreamTaskID(),
		},
		fastChannelID: {
			fastFirst.GetUpstreamTaskID(),
			fastSecond.GetUpstreamTaskID(),
		},
	}, map[string]*model.Task{
		sleepyFirst.GetUpstreamTaskID():  sleepyFirst,
		sleepySecond.GetUpstreamTaskID(): sleepySecond,
		fastFirst.GetUpstreamTaskID():    fastFirst,
		fastSecond.GetUpstreamTaskID():   fastSecond,
	})

	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.ElementsMatch(t, []string{"upstream_sleepy_1", "upstream_fast_1", "upstream_fast_2"}, adaptor.fetchedTaskIDs())
}

func TestUpdateSunoTasksStalePollsRefundExactlyOnce(t *testing.T) {
	truncate(t)

	const userID, tokenID, channelID = 401, 401, 401
	const initialUserQuota, initialTokenQuota, taskQuota = 10_000, 6_000, 2_500
	const publicTaskID, upstreamTaskID = "suno_public_refund_once", "suno_upstream_refund_once"

	seedUser(t, userID, initialUserQuota)
	seedToken(t, tokenID, userID, "sk-suno-refund-once", initialTokenQuota)
	baseURL := "https://suno.invalid"
	require.NoError(t, model.DB.Create(&model.Channel{
		Id:      channelID,
		Type:    constant.ChannelTypeSunoAPI,
		Name:    "suno_refund_once",
		Key:     "sk-suno-channel",
		Status:  common.ChannelStatusEnabled,
		BaseURL: &baseURL,
	}).Error)

	task := makeTask(userID, channelID, taskQuota, tokenID, BillingSourceWallet, 0)
	task.TaskID = publicTaskID
	task.Platform = constant.TaskPlatformSuno
	task.Status = model.TaskStatusInProgress
	task.Progress = "50%"
	task.SubmitTime = model.TaskRefundLegacyCutoff
	task.PrivateData.UpstreamTaskID = upstreamTaskID
	require.NoError(t, model.DB.Create(task).Error)

	var firstPollTask model.Task
	var staleSecondPollTask model.Task
	require.NoError(t, model.DB.First(&firstPollTask, task.ID).Error)
	require.NoError(t, model.DB.First(&staleSecondPollTask, task.ID).Error)

	adaptor := &sunoFailurePollingAdaptor{failReason: "upstream failed"}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })

	require.NoError(t, updateSunoTasks(context.Background(), channelID, []string{upstreamTaskID}, map[string]*model.Task{
		upstreamTaskID: &firstPollTask,
	}))
	require.NoError(t, updateSunoTasks(context.Background(), channelID, []string{upstreamTaskID}, map[string]*model.Task{
		upstreamTaskID: &staleSecondPollTask,
	}))

	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusFailure, reloaded.Status)
	assert.Zero(t, reloaded.Quota)
	assert.Equal(t, initialUserQuota+taskQuota, getUserQuota(t, userID))
	assert.Equal(t, initialTokenQuota+taskQuota, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, int64(1), countLogs(t))
}

func TestSweepUnrefundedFailedTasksRefundsModernTaskAndSkipsLegacy(t *testing.T) {
	truncate(t)

	const userID = 402
	const initialQuota, modernTaskQuota, legacyTaskQuota = 10_000, 1_200, 1_800
	seedUser(t, userID, initialQuota)

	modernTask := makeTask(userID, 0, modernTaskQuota, 0, BillingSourceWallet, 0)
	modernTask.TaskID = "modern_failed_pending_refund"
	modernTask.Status = model.TaskStatusFailure
	modernTask.Progress = "100%"
	modernTask.SubmitTime = model.TaskRefundLegacyCutoff
	modernTask.UpdatedAt = time.Now().Add(-time.Minute).Unix()
	require.NoError(t, model.DB.Create(modernTask).Error)

	legacyTask := makeTask(userID, 0, legacyTaskQuota, 0, BillingSourceWallet, 0)
	legacyTask.TaskID = "legacy_failed_without_refund"
	legacyTask.Status = model.TaskStatusFailure
	legacyTask.Progress = "100%"
	legacyTask.SubmitTime = model.TaskRefundLegacyCutoff - 1
	legacyTask.UpdatedAt = time.Now().Add(-time.Minute).Unix()
	require.NoError(t, model.DB.Create(legacyTask).Error)

	sweepUnrefundedFailedTasks(context.Background())
	sweepUnrefundedFailedTasks(context.Background())

	var reloadedModern model.Task
	var reloadedLegacy model.Task
	require.NoError(t, model.DB.First(&reloadedModern, modernTask.ID).Error)
	require.NoError(t, model.DB.First(&reloadedLegacy, legacyTask.ID).Error)
	assert.Zero(t, reloadedModern.Quota)
	assert.Equal(t, legacyTaskQuota, reloadedLegacy.Quota)
	assert.Equal(t, initialQuota+modernTaskQuota, getUserQuota(t, userID))
	assert.Equal(t, int64(1), countLogs(t))
}

func TestSweepUnrefundedFailedTasksRestoresMarkerAfterFundingFailure(t *testing.T) {
	truncate(t)

	const userID, subscriptionID, taskQuota = 404, 404, 900
	const subscriptionUsed int64 = 5_000
	seedUser(t, userID, 0)

	task := makeTask(userID, 0, taskQuota, 0, BillingSourceSubscription, subscriptionID)
	task.TaskID = "subscription_failed_pending_refund"
	task.Status = model.TaskStatusFailure
	task.Progress = "100%"
	task.SubmitTime = model.TaskRefundLegacyCutoff
	task.UpdatedAt = time.Now().Add(-time.Minute).Unix()
	require.NoError(t, model.DB.Create(task).Error)

	sweepUnrefundedFailedTasks(context.Background())

	var afterFailedRefund model.Task
	require.NoError(t, model.DB.First(&afterFailedRefund, task.ID).Error)
	assert.Equal(t, taskQuota, afterFailedRefund.Quota)
	assert.Equal(t, int64(0), countLogs(t))

	seedSubscription(t, subscriptionID, userID, 10_000, subscriptionUsed)
	require.NoError(t, model.DB.Model(&model.Task{}).
		Where("id = ?", task.ID).
		UpdateColumn("updated_at", time.Now().Add(-time.Minute).Unix()).Error)

	sweepUnrefundedFailedTasks(context.Background())

	var afterSuccessfulRetry model.Task
	require.NoError(t, model.DB.First(&afterSuccessfulRetry, task.ID).Error)
	assert.Zero(t, afterSuccessfulRetry.Quota)
	assert.Equal(t, subscriptionUsed-int64(taskQuota), getSubscriptionUsed(t, subscriptionID))
	assert.Equal(t, int64(1), countLogs(t))
}

func TestSubmitUnknownPollingRecoversPrivateIDAndStoresOnlyPublicData(t *testing.T) {
	truncate(t)

	const publicID = "task_public_recovery"
	task := seedSubmitUnknownVideoTask(t, 501, 501, 0, 0, publicID)
	baseURL := "http://media-runtime:3200"
	channel := &model.Channel{
		Id:      501,
		Type:    constant.ChannelTypeSora,
		Key:     "runtime-service-key",
		BaseURL: &baseURL,
	}
	adaptor := &durableVideoPollingAdaptor{
		statusCode: http.StatusOK,
		body: []byte(`{
			"id":"job_runtime_private",
			"task_id":"job_runtime_private",
			"provider_task_id":"provider_private",
			"request_id":"trace_private",
			"status":"processing",
			"progress":37
		}`),
	}

	require.NoError(t, updateVideoSingleTask(
		context.Background(),
		adaptor,
		channel,
		publicID,
		map[string]*model.Task{publicID: task},
	))
	assert.Equal(t, publicID, adaptor.fetchedID)

	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusInProgress, reloaded.Status)
	assert.Equal(t, "37%", reloaded.Progress)
	assert.Equal(t, "job_runtime_private", reloaded.PrivateData.UpstreamTaskID)
	assert.Zero(t, reloaded.SubmitRecoveryAt)
	assert.NotContains(t, string(reloaded.Data), "job_runtime_private")
	assert.NotContains(t, string(reloaded.Data), "provider_private")
	assert.NotContains(t, string(reloaded.Data), "trace_private")

	var publicData map[string]any
	require.NoError(t, common.Unmarshal(reloaded.Data, &publicData))
	assert.Equal(t, publicID, publicData["id"])
	assert.Equal(t, publicID, publicData["task_id"])
	assert.Equal(t, "dreamto-video", publicData["model"])
}

func TestSubmitUnknownPollingKeepsReservationOnRetryableResponses(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		body       string
	}{
		{
			name:       "unauthorized response",
			statusCode: http.StatusUnauthorized,
			body:       `{"error":{"message":"invalid service token","code":"invalid_api_key"}}`,
		},
		{
			name:       "runtime server error",
			statusCode: http.StatusInternalServerError,
			body:       `{"error":{"message":"temporarily unavailable","code":"video_runtime_internal_error"}}`,
		},
		{
			name:       "malformed success response",
			statusCode: http.StatusOK,
			body:       `{`,
		},
		{
			name:       "empty success response",
			statusCode: http.StatusOK,
			body:       `{}`,
		},
	}

	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			truncate(t)
			publicID := fmt.Sprintf("task_retryable_%d", index)
			task := seedSubmitUnknownVideoTask(t, 510+index, 0, 1500, 0, publicID)
			originalData := append([]byte(nil), task.Data...)
			originalRecoveryAt := task.SubmitRecoveryAt
			baseURL := "http://media-runtime:3200"
			adaptor := &durableVideoPollingAdaptor{
				statusCode: test.statusCode,
				body:       []byte(test.body),
			}

			err := updateVideoSingleTask(
				context.Background(),
				adaptor,
				&model.Channel{Type: constant.ChannelTypeSora, Key: "runtime-service-key", BaseURL: &baseURL},
				publicID,
				map[string]*model.Task{publicID: task},
			)
			require.Error(t, err)

			var reloaded model.Task
			require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
			assert.EqualValues(t, model.TaskStatusSubmitUnknown, reloaded.Status)
			assert.Equal(t, 1500, reloaded.Quota)
			assert.Equal(t, originalRecoveryAt, reloaded.SubmitRecoveryAt)
			assert.JSONEq(t, string(originalData), string(reloaded.Data))
			assert.Empty(t, reloaded.PrivateData.UpstreamTaskID)
			assert.Equal(t, int64(0), countLogs(t))
		})
	}
}

func TestSubmitUnknownPollingAuthoritativeNotFoundRefundsExactlyOnce(t *testing.T) {
	truncate(t)

	const userID, tokenID, taskQuota = 520, 520, 2500
	const postConsumeUserQuota, postConsumeTokenQuota = 7500, 3500
	const publicID = "task_authoritative_not_found"
	seedUser(t, userID, postConsumeUserQuota)
	seedToken(t, tokenID, userID, "sk-video-not-found", postConsumeTokenQuota)
	task := seedSubmitUnknownVideoTask(t, userID, 0, taskQuota, tokenID, publicID)
	baseURL := "http://media-runtime:3200"
	adaptor := &durableVideoPollingAdaptor{
		statusCode: http.StatusNotFound,
		body:       []byte(`{"error":{"message":"job was not found","type":"invalid_request_error","code":"job_not_found"}}`),
	}

	require.NoError(t, updateVideoSingleTask(
		context.Background(),
		adaptor,
		&model.Channel{Type: constant.ChannelTypeSora, Key: "runtime-service-key", BaseURL: &baseURL},
		publicID,
		map[string]*model.Task{publicID: task},
	))

	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusFailure, reloaded.Status)
	assert.Equal(t, "100%", reloaded.Progress)
	assert.Zero(t, reloaded.Quota)
	assert.Zero(t, reloaded.SubmitRecoveryAt)
	assert.NotContains(t, string(reloaded.Data), "job was not found")
	var publicData map[string]any
	require.NoError(t, common.Unmarshal(reloaded.Data, &publicData))
	assert.Equal(t, publicID, publicData["id"])
	assert.Equal(t, publicID, publicData["task_id"])
	assert.Equal(t, "failed", publicData["status"])
	errorData, ok := publicData["error"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "task_not_found", errorData["code"])
	assert.Equal(t, postConsumeUserQuota+taskQuota, getUserQuota(t, userID))
	assert.Equal(t, postConsumeTokenQuota+taskQuota, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, int64(1), countLogs(t))

	stale := *task
	stale.Quota = taskQuota
	assert.True(t, ClaimAndRefundTaskQuota(context.Background(), &stale, "duplicate reconciliation"))
	assert.Equal(t, postConsumeUserQuota+taskQuota, getUserQuota(t, userID))
	assert.Equal(t, int64(1), countLogs(t))
}
