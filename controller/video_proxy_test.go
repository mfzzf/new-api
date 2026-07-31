package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupVideoProxyTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	oldDB := model.DB
	oldLogDB := model.LOG_DB
	oldMemoryCacheEnabled := common.MemoryCacheEnabled
	oldMainDatabaseType := common.MainDatabaseType()
	oldLogDatabaseType := common.LogDatabaseType()

	gin.SetMode(gin.TestMode)
	common.MemoryCacheEnabled = false
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Task{}))

	fetchSetting := system_setting.GetFetchSetting()
	oldFetchSetting := *fetchSetting
	fetchSetting.EnableSSRFProtection = true
	fetchSetting.AllowPrivateIp = false
	fetchSetting.DomainFilterMode = false
	fetchSetting.IpFilterMode = false
	fetchSetting.DomainList = nil
	fetchSetting.IpList = nil
	fetchSetting.AllowedPorts = []string{"1-65535"}
	fetchSetting.ApplyIPFilterForDomain = true
	service.InitHttpClient()

	t.Cleanup(func() {
		service.ResetProxyClientCache()
		*fetchSetting = oldFetchSetting
		common.MemoryCacheEnabled = oldMemoryCacheEnabled
		common.SetDatabaseTypes(oldMainDatabaseType, oldLogDatabaseType)
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	return db
}

func createVideoProxyTestRecords(t *testing.T, db *gorm.DB, channelType int, baseURL string, resultURL string) model.Task {
	t.Helper()

	channel := model.Channel{
		Type:    channelType,
		Key:     "provider-secret",
		Name:    "video-proxy-test",
		BaseURL: &baseURL,
	}
	require.NoError(t, db.Create(&channel).Error)

	task := model.Task{
		TaskID:    "task_public_video",
		UserId:    42,
		ChannelId: channel.Id,
		Status:    model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{
			UpstreamTaskID: "provider-job",
			ResultURL:      resultURL,
		},
	}
	require.NoError(t, db.Create(&task).Error)
	return task
}

func invokeVideoProxy(t *testing.T, task model.Task) *httptest.ResponseRecorder {
	t.Helper()

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/videos/"+task.TaskID+"/content", nil)
	ctx.Params = gin.Params{{Key: "task_id", Value: task.TaskID}}
	ctx.Set("id", task.UserId)
	VideoProxy(ctx)
	return recorder
}

func TestVideoProxyAllowsOperatorManagedPrivateSoraBaseURL(t *testing.T) {
	db := setupVideoProxyTestDB(t)

	const content = "private-runtime-video"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/videos/provider-job/content", r.URL.Path)
		require.Equal(t, "Bearer provider-secret", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "video/mp4")
		_, err := w.Write([]byte(content))
		require.NoError(t, err)
	}))
	t.Cleanup(upstream.Close)

	task := createVideoProxyTestRecords(t, db, constant.ChannelTypeSora, upstream.URL, "")
	recorder := invokeVideoProxy(t, task)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "video/mp4", recorder.Header().Get("Content-Type"))
	require.Equal(t, content, recorder.Body.String())
}

func TestVideoProxyStillBlocksPrivateArbitraryResultURL(t *testing.T) {
	db := setupVideoProxyTestDB(t)

	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(upstream.Close)

	task := createVideoProxyTestRecords(t, db, constant.ChannelTypeMidjourney, "", upstream.URL)
	recorder := invokeVideoProxy(t, task)

	require.Equal(t, http.StatusForbidden, recorder.Code)
	require.Zero(t, requests.Load())
	require.Contains(t, recorder.Body.String(), "request blocked")
}
