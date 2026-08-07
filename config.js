const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

module.exports = {
  // OpenWA Gateway
  openwa: {
    url: process.env.OPENWA_URL || 'http://localhost:2785',
    apiKey: process.env.OPENWA_API_KEY || '',
  },

  // NVIDIA Nemotron (Guru AI)
  nemotron: {
    apiKey: process.env.NVIDIA_API_KEY || '',
    baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    model: process.env.NVIDIA_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct',
  },

  // Server
  port: parseInt(process.env.PORT, 10) || 3000,

  // AI Engine
  ai: {
    confidenceThreshold: parseInt(process.env.CONFIDENCE_THRESHOLD, 10) || 70,
    contextMessages: parseInt(process.env.CONTEXT_MESSAGES, 10) || 50,
    autoReplyEnabled: process.env.AUTO_REPLY_ENABLED !== 'false',
  },

  // Database
  dbPath: path.join(__dirname, 'data', 'bot.db'),
};
