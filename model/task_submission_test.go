package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskSubmissionKeyIsNullableAndUniqueWhenPresent(t *testing.T) {
	truncateTables(t)

	insertTask(t, &Task{TaskID: "legacy-a", Status: TaskStatusSubmitted, Progress: "10%"})
	insertTask(t, &Task{TaskID: "legacy-b", Status: TaskStatusSubmitted, Progress: "10%"})

	key := "task_public_submission_key"
	durable := &Task{
		TaskID:        key,
		SubmissionKey: &key,
		Status:        TaskStatusSubmitUnknown,
		Progress:      "0%",
	}
	insertTask(t, durable)

	duplicateKey := key
	duplicate := &Task{
		TaskID:        "different-public-id",
		SubmissionKey: &duplicateKey,
		Status:        TaskStatusSubmitting,
		Progress:      "0%",
		CreatedAt:     time.Now().Unix(),
		UpdatedAt:     time.Now().Unix(),
	}
	require.Error(t, DB.Create(duplicate).Error)

	found, exists, err := GetBySubmissionKey(key)
	require.NoError(t, err)
	require.True(t, exists)
	require.NotNil(t, found)
	assert.Equal(t, durable.ID, found.ID)
	assert.Equal(t, key, found.TaskID)

	found, exists, err = GetBySubmissionKey("")
	require.NoError(t, err)
	assert.False(t, exists)
	assert.Nil(t, found)
}

func TestGetAllUnfinishedTasksDefersPersistenceFirstRecovery(t *testing.T) {
	truncateTables(t)
	now := time.Now().Unix()
	tasks := []*Task{
		{TaskID: "submitting", Status: TaskStatusSubmitting, Progress: "0%"},
		{TaskID: "unknown-not-due", Status: TaskStatusSubmitUnknown, Progress: "0%", SubmitRecoveryAt: now + 300},
		{TaskID: "unknown-due", Status: TaskStatusSubmitUnknown, Progress: "0%", SubmitRecoveryAt: now - 1},
		{TaskID: "submitted", Status: TaskStatusSubmitted, Progress: "10%"},
		{TaskID: "success", Status: TaskStatusSuccess, Progress: "100%"},
	}
	for _, task := range tasks {
		insertTask(t, task)
	}

	unfinished := GetAllUnFinishSyncTasks(100)
	require.Len(t, unfinished, 2)
	assert.Equal(t, []string{"unknown-due", "submitted"}, []string{unfinished[0].TaskID, unfinished[1].TaskID})
	assert.Equal(t, dto.VideoStatusQueued, TaskStatus(TaskStatusSubmitUnknown).ToVideoStatus())
}
