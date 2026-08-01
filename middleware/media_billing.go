package middleware

import (
	"crypto/sha256"
	"crypto/subtle"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	MediaBillingServiceTokenHeader = "X-Media-Runtime-Token"
	MediaBillingClientIPHeader     = "X-Media-Client-IP"
	mediaBillingServiceTokenEnv    = "MEDIA_BILLING_SERVICE_TOKEN"
)

// MediaBillingServiceAuth authenticates the DreamTo runtime before TokenAuth
// processes the end-user Authorization header. The trusted runtime supplies the
// original client IP so token IP allowlists and usage logs keep their existing
// New API semantics.
func MediaBillingServiceAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		expected := strings.TrimSpace(os.Getenv(mediaBillingServiceTokenEnv))
		values := c.Request.Header.Values(MediaBillingServiceTokenHeader)
		if expected == "" {
			abortWithOpenAiMessage(c, http.StatusServiceUnavailable, "media billing service is not configured")
			return
		}
		if len(values) != 1 || !constantTimeStringEqual(expected, strings.TrimSpace(values[0])) {
			abortWithOpenAiMessage(c, http.StatusUnauthorized, "invalid media runtime credentials")
			return
		}
		clientIPValues := c.Request.Header.Values(MediaBillingClientIPHeader)
		if len(clientIPValues) != 1 {
			abortWithOpenAiMessage(c, http.StatusBadRequest, "original client IP is required")
			return
		}
		clientIP := strings.TrimSpace(clientIPValues[0])
		if net.ParseIP(clientIP) == nil {
			abortWithOpenAiMessage(c, http.StatusBadRequest, "original client IP is invalid")
			return
		}

		// Forwarding headers are caller-controlled on the public data-plane
		// request. Once the service credential is verified, use only the explicit
		// single IP value supplied by the runtime.
		c.Request.Header.Del(MediaBillingServiceTokenHeader)
		c.Request.Header.Del(MediaBillingClientIPHeader)
		c.Request.Header.Del("X-Forwarded-For")
		c.Request.Header.Del("X-Real-IP")
		c.Request.RemoteAddr = net.JoinHostPort(clientIP, "0")
		c.Next()
	}
}

func constantTimeStringEqual(expected string, presented string) bool {
	expectedHash := sha256.Sum256([]byte(expected))
	presentedHash := sha256.Sum256([]byte(presented))
	return subtle.ConstantTimeCompare(expectedHash[:], presentedHash[:]) == 1
}
