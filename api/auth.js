/**
 * ==========================================
 * VERCEL FUNCTION: api/auth.js
 * ==========================================
 * Handles credential checks and exchanges the Google Refresh Token
 * for a temporary Google Drive API Access Token.
 */

module.exports = async (req, res) => {
    // 1. Handle CORS Preflight OPTIONS request
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 2. Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { username, password } = req.body || {};

        // 3. Retrieve secrets from Environment Variables
        const expectedUsername = process.env.CUSTOM_USERNAME;
        const expectedPassword = process.env.CUSTOM_PASSWORD;
        const clientID = process.env.GD_CLIENT_ID;
        const clientSecret = process.env.GD_CLIENT_SECRET;
        const refreshToken = process.env.GD_REFRESH_TOKEN;

        // 4. Validate credentials
        if (!username || !password || username !== expectedUsername || password !== expectedPassword) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // 5. Check if Google API environment variables are configured
        if (!clientID || !clientSecret || !refreshToken) {
            return res.status(500).json({ 
                error: 'Server configuration missing. Please check Google OAuth Environment Variables on Vercel.' 
            });
        }

        // 6. Request a new temporary Access Token from Google OAuth Server
        const params = new URLSearchParams();
        params.append('client_id', clientID);
        params.append('client_secret', clientSecret);
        params.append('refresh_token', refreshToken);
        params.append('grant_type', 'refresh_token');

        const googleResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        if (!googleResponse.ok) {
            const errData = await googleResponse.json();
            console.error("Google Token Refresh Error: ", errData);
            return res.status(400).json({ error: 'Failed to refresh Google token: ' + (errData.error_description || errData.error) });
        }

        const data = await googleResponse.json();

        // 7. Success! Return the access token to the frontend client
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            access_token: data.access_token,
            expires_in: data.expires_in
        });

    } catch (err) {
        console.error("Serverless Auth Error: ", err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
