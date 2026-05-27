const express = require('express');
const admin = require('firebase-admin');
const app = express();

app.use(express.json());

// Firebase Setup
let db = null;
let initialized = false;

async function initFirebase() {
  if (initialized) return;

  try {
    const serviceAccount = require('./service-account-key.json');

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://homeiot-automanual-final-alexa-default-rtdb.asia-southeast1.firebasedatabase.app/"
    });

    db = admin.database();
    initialized = true;
    console.log("✅ Firebase Connected Successfully");
  } catch (error) {
    console.error("❌ Firebase Initialization Failed:", error.message);
    throw error;
  }
}

// Main Alexa Endpoint
app.post('/smart-home', async (req, res) => {
  try {
    await initFirebase();

    const directive = req.body.directive;
    if (!directive) return res.status(400).json({ error: "Invalid request" });

    console.log("📡 Alexa Command:", directive.header.name);

    // === DISCOVERY ===
    if (directive.header.namespace === 'Alexa.Discovery') {
      const devices = await getRegisteredDevices();
      return res.json(discoveryResponse(directive, devices));
    }

    // === COMMAND EXECUTION ===
    const endpointId = directive.endpoint?.endpointId;
    if (!endpointId) return res.status(400).json({ error: "No endpoint ID" });

    const [roomId, deviceId, type, num] = endpointId.split('-');

    if (directive.header.name === 'TurnOn' || directive.header.name === 'TurnOff') {
      const state = directive.header.name === 'TurnOn';

      if (type === 'bulb' && num) {
        await db.ref(`/rooms/${roomId}/devices/${deviceId}/states/bulb${num}`).set(state);
      } else if (type === 'fan') {
        await db.ref(`/rooms/${roomId}/devices/${deviceId}/states/fanSpeed`).set(state ? 1 : 0);
      }
    }

    if (directive.header.name === 'SetFanSpeed') {
      const speedName = directive.payload?.fanSpeed || 'low';
      let speed = 1;
      if (speedName === 'medium') speed = 2;
      if (speedName === 'high') speed = 3;

      await db.ref(`/rooms/${roomId}/devices/${deviceId}/states/fanSpeed`).set(speed);
    }

    res.json({
      event: {
        header: {
          namespace: "Alexa",
          name: "Response",
          payloadVersion: "3",
          messageId: directive.header.messageId
        },
        payload: {}
      }
    });

  } catch (error) {
    console.error("Runtime Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get all registered devices
async function getRegisteredDevices() {
  try {
    const snapshot = await db.ref('/registered-devices').once('value');
    const data = snapshot.val() || {};
    return Object.values(data);
  } catch (e) {
    console.error("Get devices error:", e.message);
    return [];
  }
}

function discoveryResponse(directive, registeredDevices) {
  const endpoints = [];

  registeredDevices.forEach(dev => {
    const room = dev.roomId || "home";
    const devId = dev.deviceId;

    // 4 Bulbs
    for (let i = 1; i <= 4; i++) {
      endpoints.push({
        id: `${room}-${devId}-bulb${i}`,
        friendlyName: `Bulb ${i}`,
        description: `Bulb ${i} in ${room}`,
        manufacturerName: "ESP8266",
        displayCategories: ["LIGHT"],
        capabilities: [{ type: "AlexaInterface", interface: "Alexa.PowerController", version: "3" }]
      });
    }

    // Fan
    endpoints.push({
      id: `${room}-${devId}-fan`,
      friendlyName: `Fan`,
      description: `Fan in ${room}`,
      manufacturerName: "ESP8266",
      displayCategories: ["FAN"],
      capabilities: [
        { type: "AlexaInterface", interface: "Alexa.PowerController", version: "3" },
        { type: "AlexaInterface", interface: "Alexa.FanController", version: "3" }
      ]
    });
  });

  return {
    event: {
      header: {
        namespace: "Alexa.Discovery",
        name: "Discover.Response",
        payloadVersion: "3",
        messageId: directive.header.messageId
      },
      payload: { endpoints }
    }
  };
}

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Alexa Smart Home Server is running on port ${PORT}`);
});
