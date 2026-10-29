/**
 * ==========================================
 * VERCEL FUNCTION: api/auth.js
 * ==========================================
 * Handles credential checks and exchanges the Google Refresh Token
 * for a temporary Google Drive API Access Token.
 * Also supports:
 *  - Password reset via Secret Code
 *  - Ghost Vault / Decoy Mode authentication & configuration
 *  - Unified .locker_config.json persistence on Google Drive
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
        const { username, password, action, newPassword, secretCode, newDecoyPassword } = req.body || {};

        // 3. Retrieve secrets from Environment Variables (auto-sanitized)
        const expectedUsername = (process.env.CUSTOM_USERNAME || '').trim();
        const expectedPassword = (process.env.CUSTOM_PASSWORD || '').trim();
        const clientID = (process.env.GD_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
        const clientSecret = (process.env.GD_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');
        const refreshToken = (process.env.GD_REFRESH_TOKEN || '').trim().replace(/^["']|["']$/g, '');
        const resetCode = (process.env.RESET_CODE || '').trim();

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
            const errData = await googleResponse.json().catch(() => ({ error: 'OAuth Request Failed' }));
            console.error("Google Token Refresh Error: ", errData);
            const detailedMsg = errData.error_description 
                ? `${errData.error} (${errData.error_description})` 
                : (errData.error || 'Bad Request');
            return res.status(400).json({ error: 'Failed to refresh Google token: ' + detailedMsg });
        }

        const tokenData = await googleResponse.json();
        const accessToken = tokenData.access_token;

        // Retrieve unified config from Google Drive
        const driveConfig = await getStoredConfig(accessToken);

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

            // Save the new password to Google Drive config (preserves other fields)
            const updatedConfig = {
                ...(driveConfig || {}),
                custom_password: newPassword
            };
            const saveSuccess = await saveConfigToDrive(accessToken, updatedConfig);
            if (!saveSuccess) {
                return res.status(500).json({ error: 'Failed to save new password to Google Drive configuration' });
            }

            // Success! Return the access token and log the user in immediately
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({
                access_token: accessToken,
                expires_in: tokenData.expires_in,
                is_decoy: false
            });
        }

        // Determine current expected master password
        let currentMasterPassword = expectedPassword;
        if (driveConfig && driveConfig.custom_password) {
            currentMasterPassword = driveConfig.custom_password;
        }

        // 6. Handle Ghost Vault settings actions (Requires Master Password)
        if (action === 'get_decoy_settings') {
            if (!password || password !== currentMasterPassword) {
                return res.status(401).json({ error: 'Unauthorized: Master Password required' });
            }
            return res.status(200).json({
                decoy_password: (driveConfig && driveConfig.decoy_password) ? driveConfig.decoy_password : '20041010'
            });
        }

        if (action === 'set_decoy_password') {
            if (!password || password !== currentMasterPassword) {
                return res.status(401).json({ error: 'Unauthorized: Master Password required to modify Decoy settings' });
            }
            if (!newDecoyPassword || typeof newDecoyPassword !== 'string' || newDecoyPassword.trim().length === 0) {
                return res.status(400).json({ error: 'Valid decoy password is required' });
            }
            if (newDecoyPassword.trim() === currentMasterPassword) {
                return res.status(400).json({ error: 'Decoy password cannot be identical to Master password' });
            }

            const updatedConfig = {
                ...(driveConfig || {}),
                decoy_password: newDecoyPassword.trim()
            };
            const saveSuccess = await saveConfigToDrive(accessToken, updatedConfig);
            if (!saveSuccess) {
                return res.status(500).json({ error: 'Failed to save Decoy settings to Google Drive configuration' });
            }

            return res.status(200).json({ success: true, message: 'Decoy password updated successfully' });
        }

        // 7. Handle standard login (Ghost Vault / Real Vault routing)
        let isDecoy = false;
        const configuredDecoyPassword = (driveConfig && driveConfig.decoy_password) ? driveConfig.decoy_password : '20041010';

        if (password === configuredDecoyPassword && configuredDecoyPassword !== currentMasterPassword) {
            isDecoy = true;
        } else if (password === currentMasterPassword) {
            isDecoy = false;
        } else {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Success! Return access token and vault mode
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            access_token: accessToken,
            expires_in: tokenData.expires_in,
            is_decoy: isDecoy
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

async function getStoredConfig(accessToken) {
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
        
        return await contentRes.json();
    } catch (err) {
        console.error("Error reading config from Drive:", err);
        return null;
    }
}

async function saveConfigToDrive(accessToken, configObj) {
    try {
        const query = "name = '.locker_config.json' and trashed = false";
        const searchUrl = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(query) + '&fields=files(id)';
        
        const searchRes = await fetch(searchUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!searchRes.ok) throw new Error("Failed to search Drive config file");
        
        const searchData = await searchRes.json();
        const fileContent = JSON.stringify(configObj, null, 2);

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
            return updateRes.ok;
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
            return createRes.ok;
        }
    } catch (err) {
        console.error("Error saving config to Drive:", err);
        return false;
    }
}
