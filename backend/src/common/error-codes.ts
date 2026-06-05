export enum ErrorCode {
  // 通用
  BAD_REQUEST = 4000,
  UNAUTHORIZED = 4001,
  FORBIDDEN = 4003,
  NOT_FOUND = 4004,
  RATE_LIMITED = 4002,
  INTERNAL_ERROR = 5000,

  // 音乐服务
  MUSIC_SEARCH_FAILED = 6001,
  MUSIC_SONG_NOT_FOUND = 6002,
  MUSIC_SONG_UNAVAILABLE = 6003,
  MUSIC_URL_EXPIRED = 6004,

  // TTS
  TTS_SYNTHESIS_FAILED = 7001,
  TTS_SERVICE_UNAVAILABLE = 7002,
  TTS_VOICE_NOT_FOUND = 7003,

  // LLM
  LLM_REQUEST_FAILED = 8001,
  LLM_QUOTA_EXCEEDED = 8002,
  LLM_TIMEOUT = 8003,

  // 网易云
  NCM_LOGIN_REQUIRED = 9001,
  NCM_COOKIE_EXPIRED = 9002,
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.BAD_REQUEST]: '请求参数错误',
  [ErrorCode.UNAUTHORIZED]: '未授权，请先登录',
  [ErrorCode.FORBIDDEN]: '无权访问',
  [ErrorCode.NOT_FOUND]: '资源不存在',
  [ErrorCode.RATE_LIMITED]: '请求过于频繁，请稍后再试',
  [ErrorCode.INTERNAL_ERROR]: '服务器内部错误',

  [ErrorCode.MUSIC_SEARCH_FAILED]: '音乐搜索失败',
  [ErrorCode.MUSIC_SONG_NOT_FOUND]: '未找到指定歌曲',
  [ErrorCode.MUSIC_SONG_UNAVAILABLE]: '歌曲暂时不可用',
  [ErrorCode.MUSIC_URL_EXPIRED]: '播放链接已过期',

  [ErrorCode.TTS_SYNTHESIS_FAILED]: '语音合成失败',
  [ErrorCode.TTS_SERVICE_UNAVAILABLE]: '语音服务暂不可用',
  [ErrorCode.TTS_VOICE_NOT_FOUND]: '指定音色不存在',

  [ErrorCode.LLM_REQUEST_FAILED]: 'AI 服务请求失败',
  [ErrorCode.LLM_QUOTA_EXCEEDED]: 'AI 服务配额已用尽',
  [ErrorCode.LLM_TIMEOUT]: 'AI 服务响应超时',

  [ErrorCode.NCM_LOGIN_REQUIRED]: '需要登录网易云账号',
  [ErrorCode.NCM_COOKIE_EXPIRED]: '登录凭证已过期，请重新登录',
}
