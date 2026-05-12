const express   = require('express');
const fetch     = require('node-fetch');
const app       = express();

app.use(express.json());

const WA_TOKEN = process.env.WA_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const WA_VERSION = process.env.WA_VERSION || 'v22.0';

if (!WA_TOKEN) console.error('ERROR: WA_TOKEN env var is not set');
if (!PHONE_ID) console.error('ERROR: PHONE_ID env var is not set');

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, phone_id: PHONE_ID ? '✅ set' : '❌ missing', token: WA_TOKEN ? '✅ set' : '❌ missing' });
});

// Send WhatsApp message — called by HF, relays to Meta
app.post('/send', async (req, res) => {
  const { recipient_id, message_data } = req.body;

  if (!recipient_id || !message_data) {
    return res.status(400).json({ error: 'Missing recipient_id or message_data' });
  }

  const url = `https://graph.facebook.com/${WA_VERSION}/${PHONE_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                recipient_id,
    ...message_data
  };

  try {
    const response = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log(`[send] ${recipient_id} -> ${response.status}`, JSON.stringify(data));
    return res.status(response.status).json(data);

  } catch (err) {
    console.error(`[send] fetch error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Relay listening on port ${PORT}`));
