const config = require('./config');
const OpenAI = require('openai');
const log = require('./logger');

const client = new OpenAI({
  apiKey: config.nemotron.apiKey,
  baseURL: config.nemotron.baseUrl,
});

let callCount = 0;

async function generate(prompt) {
  if (!config.nemotron.apiKey) {
    log.warn('⚡ Nemotron API key tidak tersedia');
    return null;
  }
  try {
    callCount++;
    log.nemotron('📤 Request #' + callCount + ' — menghubungi NVIDIA API...');
    log.startTimer('nemotron');

    var response = await client.chat.completions.create({
      model: config.nemotron.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.8,
    });

    var elapsed = log.elapsed('nemotron');
    var result = (response.choices[0] && response.choices[0].message && response.choices[0].message.content || '').trim();
    log.nemotron('📥 Response diterima → ' + result.length + ' chars ' + (elapsed || ''));
    return result;
  } catch (err) {
    log.elapsed('nemotron');
    log.err('⚡ Nemotron API error: ' + err.message.split('\n')[0]);
    return null;
  }
}

async function helpGenerate(message, context, styleProfile) {
  var styleDesc = styleProfile
    ? 'Gaya bicara: singkatan=' + JSON.stringify(styleProfile.common_abbreviations) + ', slang=' + JSON.stringify(styleProfile.slang_words) + ', emoji=' + JSON.stringify(styleProfile.emoji_patterns) + ', formality=' + styleProfile.formality_score
    : 'Gaya bicara: casual bahasa Indonesia, singkat, natural';

  var contextLines = context.map(function(m) {
    return (m.direction === 'inbound' ? 'Lawan' : 'Andri') + ': ' + m.body;
  }).join('\n');

  var prompt = 'Kamu adalah asisten AI yang belajar meniru gaya bicara seseorang. Tugasmu bukan menjawab langsung, tapi membantu sistem AI Lokal belajar.\n\n' +
    styleDesc + '\n\n' +
    'Pesan yang masuk: "' + message + '"\n\n' +
    'Konteks percakapan terakhir:\n' + contextLines + '\n\n' +
    'TUGAS: Generate 1 respons pendek yang:\n' +
    '1. Natural seperti chat WhatsApp biasa\n' +
    '2. Sesuai gaya bicara di atas\n' +
    '3. Maksimal 2 kalimat pendek\n' +
    '4. Bukan formal, bukan robot\n\n' +
    'Berikan HANYA responsnya, tanpa penjelasan.';

  return generate(prompt);
}

function getCallCount() { return callCount; }

module.exports = { generate: generate, helpGenerate: helpGenerate, getCallCount: getCallCount };
