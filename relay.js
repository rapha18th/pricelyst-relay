const express = require('express');
const fetch = require('node-fetch');
const FormData = require('form-data');
const app = express();

app.use(express.json({ limit: '35mb' }));

const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const WA_VERSION = process.env.WA_VERSION || 'v25.0';

if (!WA_TOKEN) console.error('ERROR: WA_TOKEN env var is not set');
if (!PHONE_ID) console.error('ERROR: PHONE_ID env var is not set');

function normalizeRecipient(value) {
  return String(value || '')
    .replace('whatsapp:', '')
    .replace(/^\+/, '')
    .replace(/\s+/g, '')
    .trim();
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function metaHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${WA_TOKEN}`,
    ...extra,
  };
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    phone_id: PHONE_ID ? '✅ set' : '❌ missing',
    token: WA_TOKEN ? '✅ set' : '❌ missing',
    version: WA_VERSION,
  });
});

// Send WhatsApp message — called by HF, relays to Meta
app.post('/send', async (req, res) => {
  const { recipient_id, message_data } = req.body;

  if (!recipient_id || !message_data) {
    return res.status(400).json({ error: 'Missing recipient_id or message_data' });
  }

  if (!WA_TOKEN || !PHONE_ID) {
    return res.status(500).json({ error: 'Relay missing WA_TOKEN or PHONE_ID' });
  }

  const url = `https://graph.facebook.com/${WA_VERSION}/${PHONE_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeRecipient(recipient_id),
    ...message_data,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: metaHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    const data = await readJson(response);
    console.log(`[send] ${recipient_id} -> ${response.status}`, JSON.stringify(data));
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('[send] fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Upload media — HF sends base64 JSON, Render performs multipart upload to Meta.
app.post('/upload-media', async (req, res) => {
  const { filename, mime_type, file_base64 } = req.body || {};

  if (!filename || !mime_type || !file_base64) {
    return res.status(400).json({ error: 'Missing filename, mime_type, or file_base64' });
  }

  if (!WA_TOKEN || !PHONE_ID) {
    return res.status(500).json({ error: 'Relay missing WA_TOKEN or PHONE_ID' });
  }

  const url = `https://graph.facebook.com/${WA_VERSION}/${PHONE_ID}/media`;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime_type);
  form.append('file', Buffer.from(file_base64, 'base64'), { filename, contentType: mime_type });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: metaHeaders(form.getHeaders()),
      body: form,
    });

    const data = await readJson(response);
    console.log(`[upload-media] ${filename} -> ${response.status}`, JSON.stringify(data));
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('[upload-media] fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Get media metadata including Meta temporary download URL.
app.get('/media/:mediaId', async (req, res) => {
  const mediaId = req.params.mediaId;

  if (!mediaId) {
    return res.status(400).json({ error: 'Missing media id' });
  }

  if (!WA_TOKEN) {
    return res.status(500).json({ error: 'Relay missing WA_TOKEN' });
  }

  const url = `https://graph.facebook.com/${WA_VERSION}/${mediaId}?fields=url,mime_type,sha256,file_size,id`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: metaHeaders(),
    });

    const data = await readJson(response);
    console.log(`[media] ${mediaId} -> ${response.status}`, JSON.stringify({ ...data, url: data.url ? '[url]' : undefined }));
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('[media] fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Download media bytes through Render so HF does not fetch Meta media directly.
app.get('/media/:mediaId/download', async (req, res) => {
  const mediaId = req.params.mediaId;

  if (!mediaId) {
    return res.status(400).json({ error: 'Missing media id' });
  }

  if (!WA_TOKEN) {
    return res.status(500).json({ error: 'Relay missing WA_TOKEN' });
  }

  try {
    const metaUrl = `https://graph.facebook.com/${WA_VERSION}/${mediaId}?fields=url,mime_type,sha256,file_size,id`;
    const metaResponse = await fetch(metaUrl, { headers: metaHeaders() });
    const meta = await readJson(metaResponse);

    if (!metaResponse.ok || !meta.url) {
      return res.status(metaResponse.status).json(meta);
    }

    const mediaResponse = await fetch(meta.url, { headers: metaHeaders() });
    if (!mediaResponse.ok) {
      const errText = await mediaResponse.text();
      return res.status(mediaResponse.status).send(errText);
    }

    res.setHeader('Content-Type', meta.mime_type || 'application/octet-stream');
    if (meta.file_size) res.setHeader('Content-Length', String(meta.file_size));
    mediaResponse.body.pipe(res);
  } catch (err) {
    console.error('[media/download] fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Relay listening on port ${PORT}`));
