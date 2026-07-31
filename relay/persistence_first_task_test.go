package relay

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type persistenceFirstTestAdaptor struct{}

func (persistenceFirstTestAdaptor) BuildPendingTaskData(info *relaycommon.RelayInfo) ([]byte, error) {
	return []byte(fmt.Sprintf(`{"id":%q,"task_id":%q,"status":"queued"}`, info.PublicTaskID, info.PublicTaskID)), nil
}

func (persistenceFirstTestAdaptor) BuildPublicTaskData(info *relaycommon.RelayInfo, _ []byte) ([]byte, error) {
	return []byte(fmt.Sprintf(`{"id":%q,"task_id":%q,"status":"queued"}`, info.PublicTaskID, info.PublicTaskID)), nil
}

func TestPersistenceFirstStatusUncertainty(t *testing.T) {
	tests := []struct {
		statusCode int
		uncertain  bool
	}{
		{statusCode: http.StatusRequestTimeout, uncertain: true},
		{statusCode: http.StatusConflict, uncertain: true},
		{statusCode: http.StatusTooEarly, uncertain: true},
		{statusCode: http.StatusInternalServerError, uncertain: true},
		{statusCode: http.StatusServiceUnavailable, uncertain: true},
		{statusCode: http.StatusBadRequest, uncertain: false},
		{statusCode: http.StatusUnauthorized, uncertain: false},
		{statusCode: http.StatusNotFound, uncertain: false},
		{statusCode: http.StatusTooManyRequests, uncertain: false},
	}

	for _, test := range tests {
		assert.Equal(t, test.uncertain, persistenceFirstStatusIsUncertain(test.statusCode), test.statusCode)
	}
}

func TestWritePersistenceFirstAcceptedReturnsStablePublicTask(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", nil)

	result := &TaskSubmitResult{}
	submission := &persistenceFirstSubmission{
		task:        &model.Task{TaskID: "task_public_recoverable"},
		pendingData: []byte(`{"id":"task_public_recoverable","status":"queued"}`),
	}
	writePersistenceFirstAccepted(context, result, submission, "upstream transport result is unknown")

	assert.True(t, result.SubmissionUnknown)
	assert.Equal(t, http.StatusAccepted, recorder.Code)
	assert.Equal(t, "300", recorder.Header().Get("Retry-After"))
	assert.JSONEq(t, `{"id":"task_public_recoverable","status":"queued"}`, recorder.Body.String())
}

func TestPersistenceFirstSubmissionRequiresStablePublicID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", nil)

	submission, result, taskErr := beginPersistenceFirstSubmission(
		context,
		&relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}},
		constant.TaskPlatform("sora"),
		persistenceFirstTestAdaptor{},
	)

	assert.Nil(t, submission)
	require.NotNil(t, result)
	assert.True(t, result.PersistenceFirst)
	require.NotNil(t, taskErr)
	assert.Equal(t, "missing_public_task_id", taskErr.Code)
}

func TestPersistenceFirstSubmissionDurablyTransitionsBeforePublicSuccess(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:persistence-first-submit?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	oldDB := model.DB
	oldLogDB := model.LOG_DB
	oldLogConsumeEnabled := common.LogConsumeEnabled
	oldBatchUpdateEnabled := common.BatchUpdateEnabled
	model.DB = db
	model.LOG_DB = db
	common.LogConsumeEnabled = false
	common.BatchUpdateEnabled = false
	t.Cleanup(func() {
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		common.LogConsumeEnabled = oldLogConsumeEnabled
		common.BatchUpdateEnabled = oldBatchUpdateEnabled
		require.NoError(t, sqlDB.Close())
	})

	require.NoError(t, db.AutoMigrate(&model.Task{}, &model.User{}, &model.Channel{}))

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{}`))

	info := &relaycommon.RelayInfo{
		UserId:          41,
		UsingGroup:      "default",
		OriginModelName: "dreamto-video",
		PriceData: types.PriceData{
			FreeModel: true,
			Quota:     5000,
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelId: 73,
		},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{
			Action:       constant.TaskActionGenerate,
			PublicTaskID: "task_public_durable",
		},
	}
	var adaptor channel.PersistenceFirstTaskAdaptor = persistenceFirstTestAdaptor{}

	submission, result, taskErr := beginPersistenceFirstSubmission(
		context,
		info,
		constant.TaskPlatform("sora"),
		adaptor,
	)
	require.Nil(t, taskErr)
	require.NotNil(t, submission)
	require.NotNil(t, result)
	require.NotNil(t, result.DurableTask)

	persisted, exists, err := model.GetBySubmissionKey(info.PublicTaskID)
	require.NoError(t, err)
	require.True(t, exists)
	assert.Equal(t, model.TaskStatus(model.TaskStatusSubmitUnknown), persisted.Status)
	assert.Equal(t, info.PublicTaskID, persisted.TaskID)
	assert.Greater(t, persisted.SubmitRecoveryAt, time.Now().Unix())
	assert.Zero(t, persisted.Quota)
	assert.Empty(t, persisted.PrivateData.UpstreamTaskID)

	publicData, err := buildPersistenceFirstPublicData(submission, info, []byte(`{"id":"runtime_job_private"}`))
	require.NoError(t, err)
	require.True(t, adjustPersistenceFirstQuota(context, submission, 0, nil))
	won, err := finishPersistenceFirstSubmission(submission, "runtime_job_private", publicData)
	require.NoError(t, err)
	require.True(t, won)
	assert.NotContains(t, string(publicData), "runtime_job_private")

	require.NoError(t, db.First(&persisted, persisted.ID).Error)
	assert.Equal(t, model.TaskStatus(model.TaskStatusSubmitted), persisted.Status)
	assert.Equal(t, "runtime_job_private", persisted.PrivateData.UpstreamTaskID)
	assert.Zero(t, persisted.SubmitRecoveryAt)
	assert.NotContains(t, string(persisted.Data), "runtime_job_private")
}
