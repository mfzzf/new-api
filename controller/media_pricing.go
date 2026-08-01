package controller

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/mediapricing"
	"github.com/gin-gonic/gin"
)

type mediaPricingRuleResponse struct {
	mediapricing.Rule
	Version   int   `json:"version"`
	CreatedAt int64 `json:"created_at"`
	UpdatedAt int64 `json:"updated_at"`
}

func ListMediaPricingRules(c *gin.Context) {
	records, err := model.ListMediaBillingPriceRules()
	if err != nil {
		writeMediaPricingAdminError(c, http.StatusInternalServerError, "failed to list media pricing rules")
		return
	}
	items := make([]mediaPricingRuleResponse, 0, len(records))
	for index := range records {
		item, err := projectMediaPricingRule(&records[index])
		if err != nil {
			writeMediaPricingAdminError(c, http.StatusInternalServerError, "stored media pricing rule is invalid")
			return
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

func GetMediaPricingRule(c *gin.Context) {
	modelName := strings.TrimSpace(c.Param("model"))
	record, exists, err := model.GetMediaBillingPriceRule(modelName)
	if err != nil {
		writeMediaPricingAdminError(c, http.StatusInternalServerError, "failed to load media pricing rule")
		return
	}
	if !exists {
		writeMediaPricingAdminError(c, http.StatusNotFound, "media pricing rule not found")
		return
	}
	item, err := projectMediaPricingRule(record)
	if err != nil {
		writeMediaPricingAdminError(c, http.StatusInternalServerError, "stored media pricing rule is invalid")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": item})
}

func PutMediaPricingRule(c *gin.Context) {
	modelName := strings.TrimSpace(c.Param("model"))
	var rule mediapricing.Rule
	if err := c.ShouldBindJSON(&rule); err != nil {
		writeMediaPricingAdminError(c, http.StatusBadRequest, "media pricing rule must be valid JSON")
		return
	}
	if strings.TrimSpace(rule.ModelID) != modelName {
		writeMediaPricingAdminError(c, http.StatusBadRequest, "model_id must match the request path")
		return
	}
	normalized, err := mediapricing.NormalizeAndValidate(rule)
	if err != nil {
		writeMediaPricingAdminError(c, http.StatusBadRequest, err.Error())
		return
	}
	record, err := model.UpsertMediaBillingPriceRule(normalized)
	if err != nil {
		writeMediaPricingAdminError(c, http.StatusInternalServerError, "failed to save media pricing rule")
		return
	}
	item, err := projectMediaPricingRule(record)
	if err != nil {
		writeMediaPricingAdminError(c, http.StatusInternalServerError, "stored media pricing rule is invalid")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": item})
}

func DeleteMediaPricingRule(c *gin.Context) {
	modelName := strings.TrimSpace(c.Param("model"))
	deleted, err := model.DeleteMediaBillingPriceRule(modelName)
	if err != nil {
		writeMediaPricingAdminError(c, http.StatusInternalServerError, "failed to delete media pricing rule")
		return
	}
	if !deleted {
		writeMediaPricingAdminError(c, http.StatusNotFound, "media pricing rule not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"model_id": modelName}})
}

func projectMediaPricingRule(record *model.MediaBillingPriceRule) (mediaPricingRuleResponse, error) {
	rule, err := record.Rule()
	if err != nil {
		return mediaPricingRuleResponse{}, err
	}
	return mediaPricingRuleResponse{
		Rule: rule, Version: record.Version,
		CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt,
	}, nil
}

func writeMediaPricingAdminError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"success": false, "message": message})
}
