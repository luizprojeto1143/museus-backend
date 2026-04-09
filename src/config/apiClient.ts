import axios from "axios";

/**
 * Global API Client with mandatory 10s timeout
 * Prevents external service lag from hanging the event loop.
 */
export const apiClient = axios.create({
  timeout: 10000,
  headers: {
    "Accept": "application/json",
    "Content-Type": "application/json"
  }
});

// Response interceptor for global error handling/logging
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error(`[External API Error] ${error.config?.method?.toUpperCase()} ${error.config?.url}:`, {
      status: error.response?.status,
      message: error.message,
      duration: error.duration
    });
    return Promise.reject(error);
  }
);
