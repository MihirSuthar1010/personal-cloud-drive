/**
 * ==========================================
 * VERCEL FUNCTION: api/share.js
 * ==========================================
 * Manages secure sharing links for AURA's Private Locker.
 * Persists link metadata (expiry, password, retry window) inside the user's hidden Google Drive .locker_config.json.
 */

module.exports = async (req, res) => {
    // 1. Handle CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const clientID = process.env.GD_CLIENT_ID;
        const clientSecret = process.env.GD_CLIENT_SECRET;
        const refreshToken = process.env.GD_REFRESH_TOKEN;

        if (!clientID || !clientSecret || !refreshToken) {
            return res.status(500).json({ error: 'Server configuration missing. Google OAuth variables are not set on Vercel.' });
        }

        // Get a temporary access token from Google
        const accessToken = await refreshGoogleToken(clientID, clientSecret, refreshToken);
        if (!accessToken) {
            return res.status(500).json({ error: 'Failed to authenticate with Google Drive API.' });
        }

        // ------------------------------------------
        // PATH A: POST - ADMIN ACTIONS (Create, List, Delete)
        // ------------------------------------------
        if (req.method === 'POST') {
            const { username, password, action } = req.body || {};

            // Authenticate admin credentials
            const expectedUsername = process.env.CUSTOM_USERNAME;
            const expectedPassword = process.env.CUSTOM_PASSWORD;
            
            if (!username || username !== expectedUsername) {
                return res.status(401).json({ error: 'Invalid admin username' });
            }

            // Retrieve current password (checks Google Drive for custom password override)
            let currentExpectedPassword = expectedPassword;
            const driveConfig = await getStoredConfig(accessToken);
            if (driveConfig && driveConfig.custom_password) {
                currentExpectedPassword = driveConfig.custom_password;
            }

            if (!password || password !== currentExpectedPassword) {
                return res.status(401).json({ error: 'Invalid admin password' });
            }

            const currentShares = (driveConfig && driveConfig.shares) ? driveConfig.shares : {};

            // ACTION: CREATE SHARE
            if (action === 'create') {
                const { fileId, fileName, fileSize, passwordProtection, expiresHours, maxDownloads } = req.body || {};
                if (!fileId || !fileName) {
                    return res.status(400).json({ error: 'fileId and fileName are required' });
                }

                // Generate a unique share ID
                const shareId = 'sh_' + Math.random().toString(36).substring(2, 10);

                let expiresAt = null;
                if (expiresHours && parseInt(expiresHours) > 0) {
                    expiresAt = Date.now() + (parseInt(expiresHours) * 60 * 60 * 1000);
                }

                currentShares[shareId] = {
                    fileId: fileId,
                    fileName: fileName,
                    fileSize: fileSize || 0,
                    password: passwordProtection || null, // Plain text or hashed password for the link
                    expiresAt: expiresAt,
                    maxDownloads: maxDownloads ? parseInt(maxDownloads) : null,
                    downloadCount: 0,
                    firstDownloadAt: null,
                    createdAt: Date.now()
                };

                const newConfig = {
                    ...driveConfig,
                    shares: currentShares
                };

                const saveSuccess = await saveConfigToDrive(accessToken, newConfig);
                if (!saveSuccess) {
                    return res.status(500).json({ error: 'Failed to write sharing configuration to Google Drive.' });
                }

                return res.status(200).json({ shareId: shareId });
            }

            // ACTION: DELETE SHARE
            if (action === 'delete') {
                const { shareId } = req.body || {};
                if (!shareId || !currentShares[shareId]) {
                    return res.status(400).json({ error: 'Invalid or missing shareId' });
                }

                delete currentShares[shareId];
                const newConfig = {
                    ...driveConfig,
                    shares: currentShares
                };

                const saveSuccess = await saveConfigToDrive(accessToken, newConfig);
                if (!saveSuccess) {
                    return res.status(500).json({ error: 'Failed to delete sharing link.' });
                }

                return res.status(200).json({ success: true });
            }

            // ACTION: LIST SHARES
            if (action === 'list') {
                // Clean up expired shares before returning the list
                let modified = false;
                for (const sid in currentShares) {
                    const share = currentShares[sid];
                    if (share.expiresAt && Date.now() > share.expiresAt) {
                        delete currentShares[sid];
                        modified = true;
                    }
                    if (share.firstDownloadAt && (Date.now() - share.firstDownloadAt > 15 * 60 * 1000)) {
                        delete currentShares[sid];
                        modified = true;
                    }
                }

                if (modified) {
                    await saveConfigToDrive(accessToken, { ...driveConfig, shares: currentShares });
                }

                return res.status(200).json({ shares: currentShares });
            }

            return res.status(400).json({ error: 'Invalid action' });
        }

        // ------------------------------------------
        // PATH B: GET - PUBLIC SHARE VIEW & RETRIEVAL
        // ------------------------------------------
        if (req.method === 'GET') {
            const { id, password } = req.query || {};
            if (!id) {
                return res.status(400).json({ error: 'Missing share id parameter' });
            }

            const driveConfig = await getStoredConfig(accessToken);
            if (!driveConfig || !driveConfig.shares || !driveConfig.shares[id]) {
                return res.status(404).json({ error: 'Link is invalid or has been deleted.' });
            }

            const share = driveConfig.shares[id];

            // 1. Check direct time expiration
            if (share.expiresAt && Date.now() > share.expiresAt) {
                // Auto clean up
                delete driveConfig.shares[id];
                await saveConfigToDrive(accessToken, driveConfig);
                return res.status(410).json({ error: 'Link has expired.' });
            }

            // 2. Check 15-minute retry grace period expiration
            if (share.firstDownloadAt) {
                const timeDiff = Date.now() - share.firstDownloadAt;
                if (timeDiff > 15 * 60 * 1000) {
                    // Grace window elapsed - delete link
                    delete driveConfig.shares[id];
                    await saveConfigToDrive(accessToken, driveConfig);
                    return res.status(410).json({ error: 'Link has expired after the initial download window.' });
                }
            }

            // 3. Password Verification
            if (share.password) {
                if (!password) {
                    return res.status(200).json({ 
                        passwordRequired: true, 
                        fileName: maskFileName(share.fileName),
                        fileSize: share.fileSize
                    });
                }
                if (password !== share.password) {
                    return res.status(401).json({ error: 'Incorrect password for this shared link.' });
                }
            }

            // 4. Handle 1-time download activation and logging
            let configSaved = false;
            if (share.maxDownloads && share.maxDownloads > 0) {
                if (!share.firstDownloadAt) {
                    // First time clicking download - mark initial download timestamp
                    share.firstDownloadAt = Date.now();
                    share.downloadCount += 1;
                    configSaved = true;
                }
            }

            if (configSaved) {
                await saveConfigToDrive(accessToken, driveConfig);
            }

            // 5. Generate secure, temporary download URL
            const downloadUrl = `https://www.googleapis.com/drive/v3/files/${share.fileId}?alt=media&access_token=${accessToken}`;
            
            return res.status(200).json({
                valid: true,
                fileName: share.fileName,
                fileSize: share.fileSize,
                downloadUrl: downloadUrl
            });
        }

        return res.status(405).json({ error: 'Method Not Allowed' });

    } catch (err) {
        console.error("Share Endpoint Error:", err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

/**
 * ==========================================
 * HELPERS
 * ==========================================
 */

async function refreshGoogleToken(clientID, clientSecret, refreshToken) {
    try {
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

        if (!googleResponse.ok) return null;
        const data = await googleResponse.json();
        return data.access_token;
    } catch (err) {
        console.error("Token refresh helper error:", err);
        return null;
    }
}

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
        console.error("Error reading config:", err);
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
        if (!searchRes.ok) return false;
        
        const searchData = await searchRes.json();
        const fileContent = JSON.stringify(configObj);

        if (searchData.files && searchData.files.length > 0) {
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
        console.error("Error writing config:", err);
        return false;
    }
}

function maskFileName(fileName) {
    // Masks a filename to protect security until password is correct (e.g. "Secret_Doc.pdf" -> "Sec***_Doc.pdf")
    const parts = fileName.split('.');
    const ext = parts.length > 1 ? '.' + parts.pop() : '';
    const base = parts.join('.');
    if (base.length <= 4) {
        return 'Protected_File' + ext;
    }
    return base.substring(0, 3) + '***' + base.substring(base.length - 2) + ext;
}
