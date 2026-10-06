/**
 * Rate-limit policy for the visitor auth surface. The venue shares ONE public IP (Wi-Fi NAT), so per-IP
 * ceilings are generous (≈ 1,000 visitors) and exist to stop floods; the tight limits are per phone and per
 * device. A global hourly ceiling (env OTP_GLOBAL_PER_HOUR) caps SMS cost/pumping for the whole event.
 */
export const LIMITS = {
  otpRequest: {
    perIp: { limit: 3_000, windowSec: 600 },
    perDevice: { limit: 10, windowSec: 3_600 },
    perPhone: { limit: 5, windowSec: 3_600 },
  },
  otpVerify: {
    perIp: { limit: 12_000, windowSec: 600 },
    perDevice: { limit: 40, windowSec: 600 },
  },
} as const;
