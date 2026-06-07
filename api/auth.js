/**
 * ==========================================
 * VERCEL FUNCTION: api/auth.js
 * ==========================================
 * Handles credential checks and exchanges the Google Refresh Token
 * for a temporary Google Drive API Access Token.
 * Also supports secure password reset via a Secret Code, persisting
 * the updated password inside a hidden config file on the user's Google Drive.
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
        const { username, password, action, newPassword, secretCode } = req.body || {};

        // 3. Retrieve secrets from Environment Variables
        const expectedUsername = process.env.CUSTOM_USERNAME;
        const expectedPassword = process.env.CUSTOM_PASSWORD;
        const clientID = process.env.GD_CLIENT_ID;
        const clientSecret = process.env.GD_CLIENT_SECRET;
        const refreshToken = process.env.GD_REFRESH_TOKEN;
        const resetCode = process.env.RESET_CODE;

        // Check if Google API environment variables are configured
        if (!clientID || !clientSecret || !refreshToken) {
            return res.status(500).json({ 
                error: 'Server configuration missing. Please check Google OAuth Environment Variables on Vercel.' 
            });
        }

        // Validate username first
        if (!username || username !== expectedUsername) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // 4. Request a new temporary Access Token from Google OAuth Server
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

        const tokenData = await googleResponse.json();
        const accessToken = tokenData.access_token;

        // 5. Handle password reset action
        if (action === 'reset') {
            if (!newPassword || !secretCode) {
                return res.status(400).json({ error: 'New password and secret reset code are required' });
            }
            if (!resetCode) {
                return res.status(500).json({ error: 'Forgot Password reset code is not configured on the Vercel server. Please add the RESET_CODE environment variable in Vercel settings.' });
            }
            if (secretCode !== resetCode) {
                return res.status(401).json({ error: 'Incorrect secret reset code' });
            }

            // Save the new password to Google Drive
            const saveSuccess = await savePasswordToDrive(accessToken, newPassword);
            if (!saveSuccess) {
                return res.status(500).json({ error: 'Failed to save new password to Google Drive configuration' });
            }

            // Success! Return the access token and log the user in immediately
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({
                access_token: accessToken,
                expires_in: tokenData.expires_in
            });
        }

        // 6. Handle standard login
        let currentExpectedPassword = expectedPassword;
        const drivePassword = await getStoredPasswordFromDrive(accessToken);
        if (drivePassword) {
            currentExpectedPassword = drivePassword;
        }

        if (!password || password !== currentExpectedPassword) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Success! Return the access token to the frontend client
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            access_token: accessToken,
            expires_in: tokenData.expires_in
        });

    } catch (err) {
        console.error("Serverless Auth Error: ", err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

/**
 * ==========================================
 * HELPER FUNCTIONS: Google Drive Config Store
 * ==========================================
 */

async function getStoredPasswordFromDrive(accessToken) {
    try {
        const query = "name = '.locker_config.json' and trashed = false";
        const searchUrl = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(query) + '&fields=files(id)';
        
        const searchRes = await fetch(searchUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!searchRes.ok) return null;
        
        const searchData = await searchRes.json();
        if (!searchData.files || searchData.files.length === 0) return null;

        const fileId = searchData.files[0].id;
        const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!contentRes.ok) return null;
        
        const config = await contentRes.json();
        return config.custom_password || null;
    } catch (err) {
        console.error("Error reading password from Drive config:", err);
        return null;
    }
}

async function savePasswordToDrive(accessToken, newPassword) {
    try {
        const query = "name = '.locker_config.json' and trashed = false";
        const searchUrl = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(query) + '&fields=files(id)';
        
        const searchRes = await fetch(searchUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!searchRes.ok) throw new Error("Failed to search Drive config file");
        
        const searchData = await searchRes.json();
        const fileContent = JSON.stringify({ custom_password: newPassword });

        if (searchData.files && searchData.files.length > 0) {
            // Update existing config file
            const fileId = searchData.files[0].id;
            const updateRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: fileContent
            });
            if (!updateRes.ok) throw new Error("Failed to update config file in Drive");
        } else {
            // Create a new config file
            const boundary = 'locker_config_boundary';
            const metadata = {
                name: '.locker_config.json',
                parents: ['root']
            };
            
            const multipartBody = 
                `--${boundary}\r\n` +
                `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                `${JSON.stringify(metadata)}\r\n` +
                `--${boundary}\r\n` +
                `Content-Type: application/json\r\n\r\n` +
                `${fileContent}\r\n` +
                `--${boundary}--`;

            const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`
                },
                body: multipartBody
            });
            if (!createRes.ok) throw new Error("Failed to create config file in Drive");
        }
        return true;
    } catch (err) {
        console.error("Error saving password to Drive config:", err);
        return false;
    }
}
