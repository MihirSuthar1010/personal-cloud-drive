/**
 * ==========================================
 * NETLIFY FUNCTION: auth.js
 * ==========================================
 * Handles credential checks and exchanges the Google Refresh Token
 * for a temporary Google Drive API Access Token.
 */

exports.handler = async function (event, context) {
    // 1. Handle CORS Preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    // 2. Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const { username, password } = JSON.parse(event.body || '{}');

        // 3. Retrieve secrets from Environment Variables
        const expectedUsername = process.env.CUSTOM_USERNAME;
        const expectedPassword = process.env.CUSTOM_PASSWORD;
        const clientID = process.env.GD_CLIENT_ID;
        const clientSecret = process.env.GD_CLIENT_SECRET;
        const refreshToken = process.env.GD_REFRESH_TOKEN;

        // 4. Validate credentials
        console.log("DEBUG: Received username:", username);
        console.log("DEBUG: Expected username from Netlify:", expectedUsername);
        console.log("DEBUG: CUSTOM_USERNAME is defined:", !!expectedUsername);
        console.log("DEBUG: CUSTOM_PASSWORD is defined:", !!expectedPassword);

        if (!username || !password || username !== expectedUsername || password !== expectedPassword) {
            console.log("DEBUG: Credentials mismatch!");
            return {
                statusCode: 401,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ error: 'Invalid username or password' })
            };
        }

        // 5. Check if Google API environment variables are configured
        if (!clientID || !clientSecret || !refreshToken) {
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    error: 'Server configuration missing. Please check Google OAuth Environment Variables on Netlify.' 
                })
            };
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
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ error: 'Failed to refresh Google token: ' + (errData.error_description || errData.error) })
            };
        }

        const data = await googleResponse.json();

        // 7. Success! Return the access token to the frontend client
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store'
            },
            body: JSON.stringify({
                access_token: data.access_token,
                expires_in: data.expires_in
            })
        };

    } catch (err) {
        console.error("Serverless Auth Error: ", err);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
