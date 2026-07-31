package sora

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildRequestHeaderUsesStablePublicTaskID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name         string
		action       string
		originTaskID string
		wantURL      string
	}{
		{
			name:    "generation JSON request",
			action:  constant.TaskActionGenerate,
			wantURL: "https://runtime.example/v1/videos",
		},
		{
			name:         "remix JSON request",
			action:       constant.TaskActionRemix,
			originTaskID: "upstream-video-123",
			wantURL:      "https://runtime.example/v1/videos/upstream-video-123/remix",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"model":"dreamto-video"}`))
			context.Request.Header.Set("Content-Type", "application/json")
			context.Request.Header.Set("Idempotency-Key", "user-controlled-key")

			info := &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelBaseUrl: "https://runtime.example",
					ApiKey:         "runtime-service-key-a",
				},
				TaskRelayInfo: &relaycommon.TaskRelayInfo{
					Action:       tt.action,
					OriginTaskID: tt.originTaskID,
					PublicTaskID: "task_stable_public_id",
				},
			}

			firstAdaptor := &TaskAdaptor{}
			firstAdaptor.Init(info)
			requestURL, err := firstAdaptor.BuildRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tt.wantURL, requestURL)

			firstRequest := httptest.NewRequest(http.MethodPost, requestURL, strings.NewReader(`{}`))
			require.NoError(t, firstAdaptor.BuildRequestHeader(context, firstRequest, info))
			assert.Equal(t, "task_stable_public_id", firstRequest.Header.Get("Idempotency-Key"))
			assert.NotEqual(t, context.Request.Header.Get("Idempotency-Key"), firstRequest.Header.Get("Idempotency-Key"))
			assert.Equal(t, "Bearer runtime-service-key-a", firstRequest.Header.Get("Authorization"))
			assert.Equal(t, "application/json", firstRequest.Header.Get("Content-Type"))

			// RelayTask reuses one RelayInfo across channel attempts. Channel metadata
			// may change, but the public task ID (and therefore idempotency key) must not.
			info.ChannelMeta = &relaycommon.ChannelMeta{
				ChannelBaseUrl: "https://runtime.example",
				ApiKey:         "runtime-service-key-b",
			}
			retryAdaptor := &TaskAdaptor{}
			retryAdaptor.Init(info)
			retryRequest := httptest.NewRequest(http.MethodPost, requestURL, strings.NewReader(`{}`))
			require.NoError(t, retryAdaptor.BuildRequestHeader(context, retryRequest, info))
			assert.Equal(t, firstRequest.Header.Get("Idempotency-Key"), retryRequest.Header.Get("Idempotency-Key"))
			assert.Equal(t, "Bearer runtime-service-key-b", retryRequest.Header.Get("Authorization"))
			assert.NotContains(t, retryRequest.Header.Get("Idempotency-Key"), "runtime-service-key")
		})
	}
}

func TestMultipartSubmitKeepsPublicIdempotencyKeyAcrossRetry(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	require.NoError(t, writer.WriteField("model", "client-video-model"))
	require.NoError(t, writer.WriteField("prompt", "animate this image"))
	filePart, err := writer.CreateFormFile("input_reference", "reference.png")
	require.NoError(t, err)
	_, err = filePart.Write([]byte("reference-image-bytes"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(requestBody.Bytes()))
	context.Request.Header.Set("Content-Type", writer.FormDataContentType())
	context.Request.Header.Set("Idempotency-Key", "user-controlled-key")
	defer common.CleanupBodyStorage(context)

	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl:    "https://runtime.example",
			ApiKey:            "runtime-service-key-a",
			UpstreamModelName: "provider-video-model",
		},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{
			Action:       constant.TaskActionGenerate,
			PublicTaskID: "task_stable_multipart_id",
		},
	}

	var firstIdempotencyKey string
	for attempt, serviceKey := range []string{"runtime-service-key-a", "runtime-service-key-b"} {
		info.ChannelMeta.ApiKey = serviceKey
		adaptor := &TaskAdaptor{}
		adaptor.Init(info)

		body, err := adaptor.BuildRequestBody(context, info)
		require.NoError(t, err)
		bodyBytes, err := io.ReadAll(body)
		require.NoError(t, err)
		assert.NotContains(t, string(bodyBytes), serviceKey)
		assert.NotContains(t, string(bodyBytes), "user-controlled-key")

		outbound := httptest.NewRequest(http.MethodPost, "https://runtime.example/v1/videos", bytes.NewReader(bodyBytes))
		require.NoError(t, adaptor.BuildRequestHeader(context, outbound, info))
		assert.Equal(t, "task_stable_multipart_id", outbound.Header.Get("Idempotency-Key"))
		assert.Equal(t, "Bearer "+serviceKey, outbound.Header.Get("Authorization"))
		assert.NotEqual(t, context.Request.Header.Get("Idempotency-Key"), outbound.Header.Get("Idempotency-Key"))

		if attempt == 0 {
			firstIdempotencyKey = outbound.Header.Get("Idempotency-Key")
		} else {
			assert.Equal(t, firstIdempotencyKey, outbound.Header.Get("Idempotency-Key"))
		}

		require.NoError(t, outbound.ParseMultipartForm(32<<20))
		assert.Equal(t, "provider-video-model", outbound.PostForm.Get("model"))
		assert.Equal(t, "animate this image", outbound.PostForm.Get("prompt"))
		require.Len(t, outbound.MultipartForm.File["input_reference"], 1)
		file, err := outbound.MultipartForm.File["input_reference"][0].Open()
		require.NoError(t, err)
		fileBytes, err := io.ReadAll(file)
		require.NoError(t, err)
		require.NoError(t, file.Close())
		assert.Equal(t, []byte("reference-image-bytes"), fileBytes)
	}
}

func TestBuildRequestHeaderOmitsEmptyPublicTaskID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name     string
		taskInfo *relaycommon.TaskRelayInfo
	}{
		{name: "empty public task ID", taskInfo: &relaycommon.TaskRelayInfo{}},
		{name: "missing task relay info"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{}`))
			context.Request.Header.Set("Content-Type", "application/json")
			context.Request.Header.Set("Idempotency-Key", "user-controlled-key")

			info := &relaycommon.RelayInfo{
				ChannelMeta:   &relaycommon.ChannelMeta{ApiKey: "runtime-service-key"},
				TaskRelayInfo: tt.taskInfo,
			}
			adaptor := &TaskAdaptor{}
			adaptor.Init(info)

			outbound := httptest.NewRequest(http.MethodPost, "https://runtime.example/v1/videos", strings.NewReader(`{}`))
			outbound.Header.Set("Idempotency-Key", "stale-or-user-controlled-key")
			require.NoError(t, adaptor.BuildRequestHeader(context, outbound, info))
			assert.Empty(t, outbound.Header.Get("Idempotency-Key"))
			assert.Equal(t, "Bearer runtime-service-key", outbound.Header.Get("Authorization"))
		})
	}
}

func TestFetchTaskDoesNotSendSubmitIdempotencyKey(t *testing.T) {
	type capturedRequest struct {
		method string
		path   string
		header http.Header
	}
	captured := make(chan capturedRequest, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		captured <- capturedRequest{
			method: request.Method,
			path:   request.URL.Path,
			header: request.Header.Clone(),
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"upstream-task-123","status":"processing"}`)
	}))
	defer server.Close()

	adaptor := &TaskAdaptor{}
	response, err := adaptor.FetchTask(server.URL, "runtime-service-key", map[string]any{
		"task_id":         "upstream-task-123",
		"idempotency_key": "task_submit_only",
	}, "")
	require.NoError(t, err)
	require.NotNil(t, response)
	require.NoError(t, response.Body.Close())

	request := <-captured
	assert.Equal(t, http.MethodGet, request.method)
	assert.Equal(t, "/v1/videos/upstream-task-123", request.path)
	assert.Equal(t, "Bearer runtime-service-key", request.header.Get("Authorization"))
	assert.Empty(t, request.header.Get("Idempotency-Key"))
}

func TestPersistenceFirstTaskDataDefersResponseAndHidesUpstreamID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{}`))

	info := &relaycommon.RelayInfo{
		OriginModelName: "dreamto-video",
		TaskRelayInfo: &relaycommon.TaskRelayInfo{
			PublicTaskID: "task_public_123",
		},
	}
	adaptor := &TaskAdaptor{}
	var persistenceAdaptor channel.PersistenceFirstTaskAdaptor = adaptor

	pendingData, err := persistenceAdaptor.BuildPendingTaskData(info)
	require.NoError(t, err)
	var pending responseTask
	require.NoError(t, common.Unmarshal(pendingData, &pending))
	assert.Equal(t, "task_public_123", pending.ID)
	assert.Equal(t, "task_public_123", pending.TaskID)
	assert.Equal(t, "queued", pending.Status)
	assert.Equal(t, "dreamto-video", pending.Model)

	upstreamBody := `{"id":"runtime_job_secret","task_id":"runtime_job_secret","provider_task_id":"runtime_job_secret","status":"queued","object":"video","model":"provider-video","request_id":"trace-safe"}`
	response := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(upstreamBody)),
	}
	upstreamID, rawData, taskErr := adaptor.DoResponse(context, response, info)
	require.Nil(t, taskErr)
	assert.Equal(t, "runtime_job_secret", upstreamID)
	assert.Empty(t, recorder.Body.Bytes(), "DoResponse must not write before the durable CAS")

	publicData, err := persistenceAdaptor.BuildPublicTaskData(info, rawData)
	require.NoError(t, err)
	assert.NotContains(t, string(publicData), "runtime_job_secret")
	var public responseTask
	require.NoError(t, common.Unmarshal(publicData, &public))
	assert.Equal(t, "task_public_123", public.ID)
	assert.Equal(t, "task_public_123", public.TaskID)
	assert.Equal(t, "dreamto-video", public.Model)
	var publicFields map[string]any
	require.NoError(t, common.Unmarshal(publicData, &publicFields))
	assert.NotContains(t, publicFields, "request_id")
	assert.NotContains(t, publicFields, "provider_task_id")
}

func TestBuildPublicTaskDataRequiresStablePublicID(t *testing.T) {
	adaptor := &TaskAdaptor{}
	_, err := adaptor.BuildPublicTaskData(
		&relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}},
		[]byte(`{"id":"upstream"}`),
	)
	require.Error(t, err)
}

func TestBuildPublicTaskDataRejectsNullResponse(t *testing.T) {
	adaptor := &TaskAdaptor{}
	_, err := adaptor.BuildPublicTaskData(
		&relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{PublicTaskID: "task_public"}},
		[]byte(`null`),
	)
	require.Error(t, err)
}

func TestParseAndSanitizePollingResponseKeepsPrivateIDOutOfPublicData(t *testing.T) {
	adaptor := &TaskAdaptor{}
	upstreamData := []byte(`{
		"id":"job_runtime_private",
		"task_id":"job_runtime_private",
		"provider_task_id":"provider_private",
		"request_id":"trace_private",
		"object":"video",
		"model":"provider-video",
		"status":"processing",
		"progress":37,
		"created_at":1700000000,
		"seconds":"8",
		"size":"1280x720"
	}`)

	result, err := adaptor.ParseTaskResult(upstreamData)
	require.NoError(t, err)
	assert.Equal(t, "job_runtime_private", result.TaskID)
	assert.Equal(t, string(model.TaskStatusInProgress), result.Status)
	assert.Equal(t, "37%", result.Progress)

	task := &model.Task{
		TaskID: "task_public_polling",
		Properties: model.Properties{
			OriginModelName: "dreamto-video",
		},
	}
	publicData, err := adaptor.BuildPublicPollingTaskData(task, upstreamData)
	require.NoError(t, err)
	assert.NotContains(t, string(publicData), "job_runtime_private")
	assert.NotContains(t, string(publicData), "provider_private")
	assert.NotContains(t, string(publicData), "trace_private")

	var public responseTask
	require.NoError(t, common.Unmarshal(publicData, &public))
	assert.Equal(t, "task_public_polling", public.ID)
	assert.Equal(t, "task_public_polling", public.TaskID)
	assert.Equal(t, "dreamto-video", public.Model)
	assert.Equal(t, "processing", public.Status)
	assert.Equal(t, 37, public.Progress)
}

func TestConvertToOpenAIVideoReplacesBothIdentifierFields(t *testing.T) {
	adaptor := &TaskAdaptor{}
	data, err := adaptor.ConvertToOpenAIVideo(&model.Task{
		TaskID: "task_public_response",
		Data:   []byte(`{"id":"job_private","task_id":"job_private","status":"queued"}`),
	})
	require.NoError(t, err)
	assert.NotContains(t, string(data), "job_private")

	var response responseTask
	require.NoError(t, common.Unmarshal(data, &response))
	assert.Equal(t, "task_public_response", response.ID)
	assert.Equal(t, "task_public_response", response.TaskID)
}
