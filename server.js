const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Proxy endpoint for Gemini API
app.post('/api/ai', async (req, res) => {
    const { apiKey, prompt } = req.body;

    if (!apiKey || !prompt) {
        return res.status(400).json({ error: 'Missing apiKey or prompt' });
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    maxOutputTokens: 200,
                    temperature: 0.7
                }
            })
        });

        const data = await response.json();

        if (data.error) {
            console.error('Gemini API Error:', data.error.message);
            return res.status(400).json({ error: data.error.message });
        }

        if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
            return res.status(400).json({ error: 'No response from Gemini' });
        }

        const insight = data.candidates[0].content.parts[0].text.trim();
        res.json({ insight });

    } catch (err) {
        console.error('Gemini API Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n  🚦 Traffic Simulation Server running at:\n`);
    console.log(`  → http://localhost:${PORT}\n`);
    console.log(`  Using: Google Gemini 2.5 Flash API\n`);
});
