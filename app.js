/**
 * ==========================================
 * AURA'S PRIVATE CLOUD - CLIENT JS (SERVERLESS)
 * ==========================================
 */

// Target folder name in Google Drive
const TARGET_FOLDER_NAME = 'Mihir_Privet_Cloud';

// Global State
let accessToken = null;
let tokenExpiryTime = 0; // Epoch timestamp in ms
let currentFolderId = sessionStorage.getItem('gdrive_folder_id') || null;
let allFiles = []; // To keep track of listed files for search filters
const activeTransfers = {}; // Global active transfers registry

// DOM Elements
const loginCard = document.getElementById('loginCard');
const loginForm = document.getElementById('loginForm');
const dashboard = document.getElementById('dashboard');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const userProfile = document.getElementById('userProfile');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadProgressContainer = document.getElementById('uploadProgressContainer');
const uploadingFileName = document.getElementById('uploadingFileName');
const uploadPercent = document.getElementById('uploadPercent');
const progressBarFill = document.getElementById('progressBarFill');
const fileTableBody = document.getElementById('fileTableBody');
const fileTableContainer = document.getElementById('fileTableContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');

/* ==========================================
   INITIALIZATION & AUTHENTICATION HANDLERS
   ========================================== */

window.onload = function () {
    setupEventListeners();
    checkExistingSession();
};

// Check if credentials exist in sessionStorage and log in silently
async function checkExistingSession() {
    const savedUser = sessionStorage.getItem('custom_username');
    const savedPass = sessionStorage.getItem('custom_password');

    if (savedUser && savedPass) {
        showLoading(true);
        showDashboardView();
        
        // Fetch new Google Access Token using saved credentials
        const success = await refreshAccessToken(savedUser, savedPass);
        if (success) {
            fetchStorageQuota();
            if (currentFolderId) {
                fetchFiles();
            } else {
                initializeCloudFolder();
            }
            // Start silent background refresh interval (every 45 minutes)
            setInterval(() => {
                refreshAccessToken(savedUser, savedPass);
            }, 45 * 60 * 1000);
        } else {
            // Saved credentials are invalid (e.g. user changed password on Vercel)
            handleLogout();
        }
    } else {
        showLoginView();
    }
}

// Custom Login Form Handler
async function handleCustomLogin(username, password) {
    showLoading(true);
    const success = await refreshAccessToken(username, password);
    
    if (success) {
        // Save credentials locally for auto-login next time
        sessionStorage.setItem('custom_username', username);
        sessionStorage.setItem('custom_password', password);
        
        showToast("Access granted! Connecting to your cloud...", "success");
        showDashboardView();
        
        fetchStorageQuota();
        if (currentFolderId) {
            fetchFiles();
        } else {
            initializeCloudFolder();
        }
    } else {
        showToast("Invalid username or password.", "error");
        showLoading(false);
    }
}

// Silent Login Form Handler for automatic login during typing
async function attemptSilentLogin(username, password) {
    const success = await refreshAccessToken(username, password);
    
    if (success) {
        // Save credentials locally for auto-login next time
        sessionStorage.setItem('custom_username', username);
        sessionStorage.setItem('custom_password', password);
        
        showToast("Access granted! Connecting to your cloud...", "success");
        showDashboardView();
        
        fetchStorageQuota();
        if (currentFolderId) {
            fetchFiles();
        } else {
            initializeCloudFolder();
        }
    }
}

// Contacts Vercel serverless auth endpoint to retrieve a fresh Google token
async function refreshAccessToken(username, password) {
    try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
            const err = await response.json();
            console.error("Auth server error: ", err.error);
            return false;
        }

        const data = await response.json();
        accessToken = data.access_token;
        tokenExpiryTime = Date.now() + (data.expires_in * 1000);
        return true;
    } catch (err) {
        console.error("Network error during auth: ", err);
        showToast("Connection error. Server may be offline.", "error");
        return false;
    }
}

// Safe wrapper to ensure token is fresh before making any direct Google Drive API calls
async function ensureValidToken() {
    // If token is missing or expires in less than 2 minutes, refresh it silently
    if (!accessToken || Date.now() > (tokenExpiryTime - 120000)) {
        const savedUser = sessionStorage.getItem('custom_username');
        const savedPass = sessionStorage.getItem('custom_password');
        if (savedUser && savedPass) {
            const success = await refreshAccessToken(savedUser, savedPass);
            if (!success) {
                handleLogout();
                throw new Error("Session expired");
            }
        } else {
            handleLogout();
            throw new Error("No session found");
        }
    }
}

function handleLogout() {
    accessToken = null;
    tokenExpiryTime = 0;
    sessionStorage.removeItem('custom_username');
    sessionStorage.removeItem('custom_password');
    sessionStorage.removeItem('gdrive_folder_id');
    showToast("Logged out successfully.", "info");
    showLoginView();
}

/* ==========================================
   VIEW TOGGLES & INTERFACE UPDATES
   ========================================== */

function showLoginView() {
    loginCard.style.display = 'block';
    dashboard.style.display = 'none';
    userProfile.style.display = 'none';
    showLoading(false);
}

function showDashboardView() {
    loginCard.style.display = 'none';
    dashboard.style.display = 'grid';
    userProfile.style.display = 'flex';
    
    // Set custom username label in header
    const savedUser = sessionStorage.getItem('custom_username') || 'User';
    document.getElementById('userName').textContent = `Welcome, ${savedUser}`;
}

/* ==========================================
   GOOGLE DRIVE API OPERATIONS
   ========================================== */

// Finds or creates the target folder in Google Drive root
async function initializeCloudFolder() {
    showLoading(true);
    try {
        await ensureValidToken();

        // Search for existing folder
        let response = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
                `name = '${TARGET_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
            )}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        if (!response.ok) throw new Error("Folder search failed");

        let data = await response.json();
        
        if (data.files && data.files.length > 0) {
            currentFolderId = data.files[0].id;
            sessionStorage.setItem('gdrive_folder_id', currentFolderId);
            showToast("AURA_Private_Cloud directory loaded.", "info");
            fetchFiles();
        } else {
            showToast("Creating directory on your Drive...", "info");
            let createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: TARGET_FOLDER_NAME,
                    mimeType: 'application/vnd.google-apps.folder'
                })
            });

            if (!createResponse.ok) throw new Error("Folder creation failed");
            
            let folder = await createResponse.json();
            currentFolderId = folder.id;
            sessionStorage.setItem('gdrive_folder_id', currentFolderId);
            showToast("Directory created successfully!", "success");
            fetchFiles();
        }
    } catch (error) {
        console.error("Error initializing directory: ", error);
        showToast("Error loading cloud drive.", "error");
        showLoading(false);
    }
}

// Fetch files from Google Drive
async function fetchFiles() {
    if (!currentFolderId) return;
    showLoading(true);
    try {
        await ensureValidToken();

        let response = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
                `'${currentFolderId}' in parents and trashed = false`
            )}&fields=files(id,name,mimeType,size,createdTime,webContentLink)&orderBy=createdTime desc`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        if (!response.ok) throw new Error("Listing files failed");

        let data = await response.json();
        allFiles = data.files || [];
        localFileCount = allFiles.length;
        renderFileList(allFiles);
        syncHunterStats();
        fetchStorageQuota();
    } catch (error) {
        console.error("Error fetching files: ", error);
        showToast("Error retrieving files.", "error");
    } finally {
        showLoading(false);
    }
}

// Fetch Google Drive Storage Quota
async function fetchStorageQuota() {
    try {
        await ensureValidToken();
        let response = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (response.ok) {
            let data = await response.json();
            if (data.storageQuota) {
                const limit = parseInt(data.storageQuota.limit);
                const usage = parseInt(data.storageQuota.usage);
                localStorageUsed = usage;
                syncHunterStats();
                const free = limit - usage;
                
                let percent = (usage / limit) * 100;
                if (isNaN(percent)) percent = 0;
                const percentText = percent < 0.1 && percent > 0 ? percent.toFixed(2) : Math.round(percent);
                
                document.getElementById('storageUsageText').textContent = `${formatBytes(usage)} (${percentText}%)`;
                document.getElementById('storageFreeText').textContent = `Free: ${formatBytes(free)}`;
                document.getElementById('storageTotalText').textContent = `Total: ${formatBytes(limit)}`;
                document.getElementById('storageBarFill').style.width = `${percent}%`;
            }
        }
    } catch (err) {
        console.error("Failed to fetch storage quota: ", err);
    }
}

// Render files table
function renderFileList(files) {
    fileTableBody.innerHTML = '';
    
    if (files.length === 0) {
        emptyState.style.display = 'flex';
        fileTableContainer.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    fileTableContainer.style.display = 'block';

    files.forEach(file => {
        const row = document.createElement('tr');
        const iconClass = getFileIconClass(file.mimeType, file.name);
        const formattedSize = formatBytes(file.size);
        const escapedName = file.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const formattedDate = new Date(file.createdTime).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        row.innerHTML = `
            <td>
                <div class="file-name-cell" onclick="downloadFile('${file.id}')" style="cursor: pointer; text-decoration: underline; text-underline-offset: 4px; text-decoration-color: rgba(255,255,255,0.15);">
                    <span class="file-icon"><i class="${iconClass}"></i></span>
                    <span class="file-display-name" title="${file.name}">${file.name}</span>
                </div>
            </td>
            <td>${formattedSize}</td>
            <td>${formattedDate}</td>
            <td class="actions-col">
                <div class="actions-cell">
                    <button class="btn-action btn-share-manager" onclick="openCreateShareModal('${file.id}', '${escapedName}', ${file.size})" title="Share File" style="background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.2); color: var(--accent-blue); padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                        <i class="fa-solid fa-share-nodes"></i>
                    </button>
                    <button class="btn-action btn-download" onclick="downloadFile('${file.id}')" title="Download">
                        <i class="fa-solid fa-download"></i>
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteFile('${file.id}', '${file.name}')" title="Delete">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </td>
        `;
        fileTableBody.appendChild(row);
    });
}

// Upload files with Pause/Resume/Cancel
async function handleFileUploads(files) {
    if (!currentFolderId) {
        showToast("Cloud directory is not initialized.", "error");
        return;
    }

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const transferId = 'upload-' + Date.now() + '-' + i;
        
        // Register transfer state
        activeTransfers[transferId] = {
            type: 'upload',
            fileName: file.name,
            file: file,
            size: file.size,
            offset: 0,
            paused: false,
            canceled: false,
            xhr: null,
            uploadUrl: null
        };
        
        // Render in transfers panel
        renderTransferItem(transferId, file.name, 'upload', file.size);
        
        try {
            await runUploadFlow(transferId);
        } catch (err) {
            console.error("Upload error for file:", file.name, err);
            if (activeTransfers[transferId] && !activeTransfers[transferId].paused && !activeTransfers[transferId].canceled) {
                showToast(`Upload failed: ${file.name}`, "error");
                removeTransfer(transferId);
            }
        }
    }
}

async function runUploadFlow(transferId) {
    const transfer = activeTransfers[transferId];
    if (!transfer || transfer.canceled) return;
    
    await ensureValidToken();
    
    // Step 1: Initiate session if not already done
    if (!transfer.uploadUrl) {
        updateTransferProgressUI(transferId, 0, `<i class="fa-solid fa-spinner fa-spin"></i> Initializing Gate...`);
        
        const metadata = {
            name: transfer.fileName,
            parents: [currentFolderId]
        };
        
        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': transfer.file.type || 'application/octet-stream',
                'X-Upload-Content-Length': transfer.size
            },
            body: JSON.stringify(metadata)
        });
        
        if (!response.ok) throw new Error("Google initiation failed");
        
        transfer.uploadUrl = response.headers.get('Location');
        if (!transfer.uploadUrl) throw new Error("Google did not return upload session URL");
    }
    
    if (transfer.paused || transfer.canceled) return;
    
    updateTransferProgressUI(transferId, Math.round((transfer.offset / transfer.size) * 100), `<i class="fa-solid fa-arrow-up-from-bracket"></i> Uploading...`);
    
    await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        transfer.xhr = xhr;
        
        xhr.open('PUT', transfer.uploadUrl, true);
        xhr.setRequestHeader('Content-Range', `bytes ${transfer.offset}-${transfer.size - 1}/${transfer.size}`);
        xhr.setRequestHeader('Content-Type', transfer.file.type || 'application/octet-stream');
        
        xhr.upload.onprogress = (e) => {
            if (transfer.paused || transfer.canceled) return;
            if (e.lengthComputable) {
                const uploadedBytes = transfer.offset + e.loaded;
                const percent = Math.min(99, Math.round((uploadedBytes / transfer.size) * 100));
                updateTransferProgressUI(transferId, percent, `<i class="fa-solid fa-arrow-up-from-bracket"></i> Uploading...`);
            }
        };
        
        xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 201) {
                updateTransferProgressUI(transferId, 100, `<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> Completed`);
                playTransferSound('success');
                showToast(`Uploaded successfully: ${transfer.fileName}`, "success");
                setTimeout(() => {
                    removeTransfer(transferId);
                    fetchFiles();
                }, 1500);
                resolve();
            } else if (xhr.status === 308) {
                resolve();
            } else {
                reject(new Error(`Upload HTTP Status: ${xhr.status}`));
            }
        };
        
        xhr.onerror = () => {
            reject(new Error("Network connection error"));
        };
        
        xhr.send(transfer.file.slice(transfer.offset));
    });
}

// Delete file from the cloud folder
async function deleteFile(fileId, fileName) {
    if (!confirm(`Are you sure you want to delete '${fileName}'?`)) return;
    
    try {
        await ensureValidToken();

        // 1. Attempt to move the file/folder to Trash (Standard Safe Delete)
        let response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'PATCH',
            headers: { 
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ trashed: true })
        });

        let errorMsg = "";
        
        if (response.ok) {
            showToast(`Moved to trash successfully: ${fileName}`, "success");
            fetchFiles();
            return;
        } else {
            // Read Google API error message
            try {
                let errData = await response.json();
                errorMsg = errData.error && errData.error.message ? errData.error.message : response.statusText;
            } catch (e) {
                errorMsg = response.statusText;
            }
            console.warn(`Trash request failed: ${errorMsg}. Falling back to permanent delete...`);
            
            // 2. Fallback to permanent DELETE
            let deleteResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (deleteResponse.ok) {
                showToast(`Permanently deleted: ${fileName}`, "success");
                fetchFiles();
            } else {
                let deleteErrorMsg = "";
                try {
                    let errData = await deleteResponse.json();
                    deleteErrorMsg = errData.error && errData.error.message ? errData.error.message : deleteResponse.statusText;
                } catch (e) {
                    deleteErrorMsg = deleteResponse.statusText;
                }
                
                // If it is a permission issue, show a helpful message about regenerating token/scope
                if (deleteResponse.status === 403 || deleteErrorMsg.toLowerCase().includes("permission") || deleteErrorMsg.toLowerCase().includes("insufficient")) {
                    throw new Error(`Insufficient permissions to delete this file/folder. Please run setup.html to update your Google Drive token with elevated permissions.`);
                }
                throw new Error(deleteErrorMsg);
            }
        }
    } catch (err) {
        console.error("Delete failed: ", err);
        showToast(`Failed to delete: ${err.message || "Unknown error"}`, "error");
    }
}

// Recursively list all files in a Google Drive folder
async function fetchAllFilesRecursively(folderId, relativePath = "") {
    await ensureValidToken();
    let filesList = [];
    
    let response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
            `'${folderId}' in parents and trashed = false`
        )}&fields=files(id,name,mimeType,size)`,
        {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }
    );
    
    if (!response.ok) throw new Error("Failed to list files inside folder");
    
    const data = await response.json();
    const items = data.files || [];
    
    for (const item of items) {
        if (item.mimeType === 'application/vnd.google-apps.folder') {
            const subFiles = await fetchAllFilesRecursively(item.id, relativePath + item.name + "/");
            filesList.push(...subFiles);
        } else {
            item.relativePath = relativePath + item.name;
            filesList.push(item);
        }
    }
    
    return filesList;
}

// Download Folder as ZIP using JSZip
async function downloadFolderAsZip(folderId, folderName) {
    const transferId = 'folder-' + Date.now();
    renderTransferItem(transferId, `${folderName}.zip`, 'download', 0);
    updateTransferProgressUI(transferId, 5, `<i class="fa-solid fa-spinner fa-spin"></i> Scanning folder...`);
    
    activeTransfers[transferId] = {
        type: 'download',
        fileName: `${folderName}.zip`,
        fileId: folderId,
        size: 0,
        offset: 0,
        paused: false,
        canceled: false,
        xhr: null
    };

    try {
        await ensureValidToken();
        const filesList = await fetchAllFilesRecursively(folderId, "");
        
        if (filesList.length === 0) {
            showToast(`Folder '${folderName}' is empty.`, "warning");
            removeTransfer(transferId);
            return;
        }

        if (typeof JSZip === 'undefined') {
            showToast("Loading ZIP library...", "info");
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (typeof JSZip === 'undefined') {
                throw new Error("JSZip is not available. Please refresh the page.");
            }
        }

        const zip = new JSZip();
        const googleMimeTypeExports = {
            'application/vnd.google-apps.document': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
            'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
            'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
            'application/vnd.google-apps.drawing': { mime: 'image/png', ext: 'png' }
        };

        for (let i = 0; i < filesList.length; i++) {
            if (activeTransfers[transferId]?.canceled) return;
            
            const subFile = filesList[i];
            const currentPercent = Math.min(70, Math.round(((i) / filesList.length) * 70));
            updateTransferProgressUI(transferId, currentPercent, `<i class="fa-solid fa-arrow-down"></i> [${i + 1}/${filesList.length}] ${subFile.name}`);
            
            await ensureValidToken();
            let fileUrl = `https://www.googleapis.com/drive/v3/files/${subFile.id}?alt=media`;
            let finalPath = subFile.relativePath;

            if (subFile.mimeType && googleMimeTypeExports[subFile.mimeType]) {
                const exportConfig = googleMimeTypeExports[subFile.mimeType];
                fileUrl = `https://www.googleapis.com/drive/v3/files/${subFile.id}/export?mimeType=${encodeURIComponent(exportConfig.mime)}`;
                if (!finalPath.toLowerCase().endsWith('.' + exportConfig.ext)) {
                    finalPath = `${finalPath}.${exportConfig.ext}`;
                }
            }

            const fileRes = await fetch(fileUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (!fileRes.ok) throw new Error(`Failed to download ${subFile.name}`);
            const fileBlob = await fileRes.blob();
            zip.file(finalPath, fileBlob);
        }

        if (activeTransfers[transferId]?.canceled) return;

        updateTransferProgressUI(transferId, 75, `<i class="fa-solid fa-file-zipper"></i> Packaging ZIP...`);

        const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
            const zippingPercent = Math.min(99, 70 + Math.round(metadata.percent * 0.29));
            updateTransferProgressUI(transferId, zippingPercent, `<i class="fa-solid fa-file-zipper"></i> Compressing (${Math.round(metadata.percent)}%)...`);
        });

        updateTransferProgressUI(transferId, 100, `<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> Completed`);
        playTransferSound('success');

        const zipUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = zipUrl;
        a.download = `${folderName}.zip`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(zipUrl);

        showToast(`Folder '${folderName}' downloaded successfully as ZIP! 📁`, "success");
        setTimeout(() => removeTransfer(transferId), 1500);

    } catch (err) {
        console.error("Folder download failed: ", err);
        showToast(`Folder download failed: ${err.message || "Unknown error"}`, "error");
        removeTransfer(transferId);
    }
}

// Download File via modern onprogress streaming (supports all formats & workspace exports)
async function downloadFile(fileId) {
    const file = allFiles.find(f => f.id === fileId);
    let fileName = file ? file.name : "download";
    const mimeType = file ? file.mimeType : "";
    const fileSize = file && file.size ? parseInt(file.size) : 0;
    
    if (mimeType === 'application/vnd.google-apps.folder') {
        downloadFolderAsZip(fileId, fileName);
        return;
    }
    
    // Suggest native browser download for very large files (>200MB) to prevent tab memory limits
    if (fileSize > 200 * 1024 * 1024) {
        const useNative = confirm(
            `File size is very large (${formatBytes(fileSize)}).\n\n` +
            `To prevent browser tab memory limits, we recommend using Browser-Native Download.\n\n` +
            `Click OK to download natively in your browser.\n` +
            `Click CANCEL to download inside the app (Active Gates).`
        );
        if (useNative) {
            triggerNativeDownload(fileId, fileName, mimeType);
            return;
        }
    }
    
    const transferId = 'download-' + Date.now();
    
    activeTransfers[transferId] = {
        type: 'download',
        fileName: fileName,
        fileId: fileId,
        mimeType: mimeType,
        size: fileSize,
        offset: 0,
        paused: false,
        canceled: false,
        xhr: null
    };
    
    renderTransferItem(transferId, fileName, 'download', fileSize);
    runDownloadFlow(transferId);
}

async function runDownloadFlow(transferId) {
    const transfer = activeTransfers[transferId];
    if (!transfer || transfer.canceled || transfer.paused) return;
    
    updateTransferProgressUI(transferId, 0, `<i class="fa-solid fa-arrow-down"></i> Connecting...`);
    
    try {
        await ensureValidToken();
        
        let url = `https://www.googleapis.com/drive/v3/files/${transfer.fileId}?alt=media`;
        
        const googleMimeTypeExports = {
            'application/vnd.google-apps.document': {
                mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                ext: 'docx'
            },
            'application/vnd.google-apps.spreadsheet': {
                mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                ext: 'xlsx'
            },
            'application/vnd.google-apps.presentation': {
                mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                ext: 'pptx'
            },
            'application/vnd.google-apps.drawing': {
                mime: 'image/png',
                ext: 'png'
            }
        };

        const isWorkspace = transfer.mimeType && googleMimeTypeExports[transfer.mimeType];
        
        if (isWorkspace) {
            const exportConfig = googleMimeTypeExports[transfer.mimeType];
            url = `https://www.googleapis.com/drive/v3/files/${transfer.fileId}/export?mimeType=${encodeURIComponent(exportConfig.mime)}`;
            if (!transfer.fileName.toLowerCase().endsWith('.' + exportConfig.ext)) {
                transfer.fileName = `${transfer.fileName}.${exportConfig.ext}`;
            }
        }

        await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            transfer.xhr = xhr;
            
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
            xhr.responseType = 'blob';
            
            xhr.onprogress = (e) => {
                if (transfer.paused || transfer.canceled) return;
                const totalBytes = transfer.size || e.total || 0;
                if (totalBytes > 0) {
                    const percent = Math.min(99, Math.round((e.loaded / totalBytes) * 100));
                    updateTransferProgressUI(transferId, percent, `<i class="fa-solid fa-arrow-down"></i> Downloading (${percent}%)...`);
                } else {
                    updateTransferProgressUI(transferId, 50, `<i class="fa-solid fa-arrow-down"></i> Downloading...`);
                }
            };
            
            xhr.onload = () => {
                if (xhr.status === 200 || xhr.status === 206) {
                    updateTransferProgressUI(transferId, 100, `<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> Completed`);
                    playTransferSound('success');
                    
                    const blob = xhr.response;
                    const downloadUrl = URL.createObjectURL(blob);
                    
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = transfer.fileName;
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(downloadUrl);
                    
                    showToast(`Download complete: ${transfer.fileName}`, "success");
                    setTimeout(() => {
                        removeTransfer(transferId);
                    }, 1500);
                    resolve();
                } else {
                    reject(new Error(`Google API Status ${xhr.status}: ${xhr.statusText}`));
                }
            };
            
            xhr.onerror = () => {
                reject(new Error("Network connection error"));
            };
            
            xhr.onabort = () => {
                resolve();
            };
            
            xhr.send();
        });
        
    } catch (err) {
        console.error("Download flow failed:", err);
        if (transfer && !transfer.paused && !transfer.canceled) {
            showToast(`Download failed: ${transfer.fileName}. Attempting direct download...`, "warning");
            try {
                triggerNativeDownload(transfer.fileId, transfer.fileName, transfer.mimeType);
            } catch (fallbackErr) {
                showToast(`Download failed: ${transfer.fileName}`, "error");
            }
            removeTransfer(transferId);
        }
    }
}

/* ==========================================
   HELPER UTILITIES
   ========================================== */

function showLoading(isLoading) {
    if (isLoading) {
        loadingIndicator.style.display = 'flex';
        fileTableContainer.style.display = 'none';
        emptyState.style.display = 'none';
    } else {
        loadingIndicator.style.display = 'none';
    }
}

function showUploadProgress(isUploading, name = '', index = 0, total = 0) {
    if (isUploading) {
        uploadProgressContainer.style.display = 'block';
        if (total > 1) {
            uploadingFileName.textContent = `Uploading [${index}/${total}]: ${name}`;
        } else {
            uploadingFileName.textContent = `Uploading: ${name}`;
        }
        updateProgressBar(0);
    } else {
        uploadProgressContainer.style.display = 'none';
    }
}

function updateProgressBar(percent) {
    uploadPercent.textContent = `${percent}%`;
    progressBarFill.style.width = `${percent}%`;
}

function setupEventListeners() {
    // Password visibility toggle
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('customPassword');
    const usernameInput = document.getElementById('customUsername');
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function () {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            this.classList.toggle('fa-eye');
            this.classList.toggle('fa-eye-slash');
        });
    }

    // Debounced Silent Auto-Login during typing
    let autoLoginTimeout;
    function triggerAutoLogin() {
        clearTimeout(autoLoginTimeout);
        const user = usernameInput ? usernameInput.value.trim() : '';
        const pass = passwordInput ? passwordInput.value.trim() : '';
        
        if (user && pass.length >= 4) {
            autoLoginTimeout = setTimeout(() => {
                attemptSilentLogin(user, pass);
            }, 600);
        }
    }

    if (usernameInput) {
        usernameInput.addEventListener('input', triggerAutoLogin);
    }
    if (passwordInput) {
        passwordInput.addEventListener('input', triggerAutoLogin);
    }

    // Custom Login Form Listener (runs on Enter key press)
    loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        clearTimeout(autoLoginTimeout);
        const user = usernameInput ? usernameInput.value.trim() : '';
        const pass = passwordInput ? passwordInput.value.trim() : '';
        handleCustomLogin(user, pass);
    });

    // Forgot Password View Toggles
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const backToLoginBtn = document.getElementById('backToLoginBtn');
    const loginView = document.getElementById('loginView');
    const forgotView = document.getElementById('forgotView');
    const forgotForm = document.getElementById('forgotForm');

    if (forgotPasswordLink && loginView && forgotView) {
        forgotPasswordLink.addEventListener('click', function (e) {
            e.preventDefault();
            clearTimeout(autoLoginTimeout);
            loginView.style.display = 'none';
            forgotView.style.display = 'block';
        });
    }

    if (backToLoginBtn && loginView && forgotView) {
        backToLoginBtn.addEventListener('click', function () {
            forgotView.style.display = 'none';
            loginView.style.display = 'block';
        });
    }

    // Forgot Password Form Submit
    if (forgotForm) {
        forgotForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const username = document.getElementById('resetUsername').value.trim();
            const newPassword = document.getElementById('resetNewPassword').value.trim();
            const secretCode = document.getElementById('resetSecretCode').value.trim();

            showLoading(true);

            try {
                const response = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'reset',
                        username,
                        newPassword,
                        secretCode
                    })
                });

                if (!response.ok) {
                    const err = await response.json();
                    showToast(err.error || "Password reset failed.", "error");
                    showLoading(false);
                    return;
                }

                const data = await response.json();
                accessToken = data.access_token;
                tokenExpiryTime = Date.now() + (data.expires_in * 1000);

                // Save credentials locally for auto-login next time
                sessionStorage.setItem('custom_username', username);
                sessionStorage.setItem('custom_password', newPassword);

                showToast("Password updated and logged in successfully!", "success");
                showDashboardView();

                // Clear fields
                forgotForm.reset();
                forgotView.style.display = 'none';
                loginView.style.display = 'block';

                fetchStorageQuota();
                if (currentFolderId) {
                    fetchFiles();
                } else {
                    initializeCloudFolder();
                }

            } catch (err) {
                console.error("Password reset error:", err);
                showToast("Network error during password reset.", "error");
                showLoading(false);
            }
        });
    }

    logoutBtn.addEventListener('click', handleLogout);
    refreshBtn.addEventListener('click', fetchFiles);

    // Search filter
    searchInput.addEventListener('input', function (e) {
        const query = e.target.value.toLowerCase();
        const filtered = allFiles.filter(f => f.name.toLowerCase().includes(query));
        renderFileList(filtered);
    });

    // Drag and Drop Zone Config & Browse Buttons
    const btnUploadFiles = document.getElementById('btnUploadFiles');
    const btnUploadFolder = document.getElementById('btnUploadFolder');
    const folderInput = document.getElementById('folderInput');

    if (dropZone) {
        dropZone.addEventListener('click', (e) => {
            if (e.target.id === 'btnUploadFiles' || e.target.id === 'btnUploadFolder' || e.target.closest('#btnUploadFiles') || e.target.closest('#btnUploadFolder')) {
                return;
            }
            if (fileInput) fileInput.click();
        });
    }

    if (btnUploadFiles && fileInput) {
        btnUploadFiles.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });
    }

    if (btnUploadFolder && folderInput) {
        btnUploadFolder.addEventListener('click', (e) => {
            e.stopPropagation();
            folderInput.click();
        });
    }
    
    if (fileInput) {
        fileInput.addEventListener('change', function (e) {
            if (e.target.files.length > 0) {
                handleFileUploads(e.target.files);
                fileInput.value = '';
            }
        });
    }

    if (folderInput) {
        folderInput.addEventListener('change', function (e) {
            if (e.target.files.length > 0) {
                handleFileUploads(e.target.files);
                folderInput.value = '';
            }
        });
    }

    if (dropZone) {
        dropZone.addEventListener('dragover', function (e) {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', function () {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', async function (e) {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            
            const items = e.dataTransfer.items;
            if (items && items.length > 0) {
                const fileList = [];
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (item.webkitGetAsEntry) {
                        const entry = item.webkitGetAsEntry();
                        if (entry) {
                            const files = await traverseFileTree(entry);
                            fileList.push(...files);
                        }
                    }
                }
                if (fileList.length > 0) {
                    handleFileUploads(fileList);
                    return;
                }
            }
            
            if (e.dataTransfer.files.length > 0) {
                handleFileUploads(e.dataTransfer.files);
            }
        });
    }

    // Share link managers event listeners
    const manageSharesBtn = document.getElementById('manageSharesBtn');
    if (manageSharesBtn) {
        manageSharesBtn.addEventListener('click', () => {
            document.getElementById('manageSharesModal').style.display = 'flex';
            loadActiveShares();
        });
    }
}

// Recursively traverse local directory structure for drag and drop
async function traverseFileTree(entry, path = "") {
    return new Promise((resolve) => {
        if (entry.isFile) {
            entry.file((file) => {
                file.filepath = path + file.name;
                resolve([file]);
            });
        } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            let allEntries = [];
            
            const readEntriesBatch = () => {
                dirReader.readEntries(async (entries) => {
                    if (entries.length > 0) {
                        allEntries = allEntries.concat(entries);
                        readEntriesBatch();
                    } else {
                        const results = [];
                        for (const childEntry of allEntries) {
                            const files = await traverseFileTree(childEntry, path + entry.name + "/");
                            results.push(...files);
                        }
                        resolve(results);
                    }
                });
            };
            readEntriesBatch();
        } else {
            resolve([]);
        }
    });
}

// Sound feedback system using Web Audio API
function playTransferSound(type) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        const now = audioCtx.currentTime;
        
        if (type === 'pause') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.3);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'resume') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.exponentialRampToValueAtTime(600, now + 0.25);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.25);
            osc.start(now);
            osc.stop(now + 0.25);
        } else if (type === 'cancel') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
            
            setTimeout(() => {
                const osc2 = audioCtx.createOscillator();
                const gain2 = audioCtx.createGain();
                osc2.connect(gain2);
                gain2.connect(audioCtx.destination);
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(250, audioCtx.currentTime);
                gain2.gain.setValueAtTime(0.12, audioCtx.currentTime);
                gain2.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
                osc2.start(audioCtx.currentTime);
                osc2.stop(audioCtx.currentTime + 0.12);
            }, 120);
        } else if (type === 'success') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.setValueAtTime(900, now + 0.08);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
        }
    } catch (e) {
        console.error("Audio synth error:", e);
    }
}

// Transfers Panel UI Manager
function updateTransfersCardVisibility() {
    const card = document.getElementById('transfersCard');
    const badge = document.getElementById('activeTransfersCount');
    const count = Object.keys(activeTransfers).length;
    
    if (badge) badge.textContent = count;
    if (card) {
        card.style.display = count > 0 ? 'block' : 'none';
    }
}

function renderTransferItem(id, name, type, size) {
    const list = document.getElementById('transfersList');
    if (!list) return;
    
    const typeLabel = type === 'upload' ? 'Upload Gate' : 'Download Gate';
    const typeIcon = type === 'upload' ? 'fa-arrow-up-from-bracket' : 'fa-arrow-down';
    const typeClass = type;
    
    let item = document.getElementById(`transfer-${id}`);
    if (!item) {
        item = document.createElement('div');
        item.id = `transfer-${id}`;
        list.appendChild(item);
    }
    
    item.className = `transfer-item active ${typeClass}`;
    item.innerHTML = `
        <div class="transfer-meta">
            <div class="transfer-info">
                <div class="transfer-name" title="${name}">${name}</div>
                <div class="transfer-status-label" id="status-label-${id}">
                    <i class="fa-solid fa-${typeIcon}"></i> ${typeLabel} (${formatBytes(size)})
                </div>
            </div>
            <div class="transfer-actions">
                <button class="btn-transfer-action btn-pause-resume" id="btn-pause-${id}" onclick="toggleTransfer('${id}')" title="Pause">
                    <i class="fa-solid fa-pause"></i>
                </button>
                <button class="btn-transfer-action btn-cancel" onclick="cancelTransfer('${id}')" title="Cancel">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
        <div class="transfer-progress-container">
            <div class="transfer-progress-bar">
                <div class="transfer-progress-fill" id="fill-${id}" style="width: 0%"></div>
            </div>
            <div class="transfer-percent" id="percent-${id}">0%</div>
        </div>
    `;
    updateTransfersCardVisibility();
}

function updateTransferProgressUI(id, percent, statusText = '') {
    const fill = document.getElementById(`fill-${id}`);
    const percentEl = document.getElementById(`percent-${id}`);
    const statusLabel = document.getElementById(`status-label-${id}`);
    
    if (fill) fill.style.width = `${percent}%`;
    if (percentEl) percentEl.textContent = `${percent}%`;
    if (statusText && statusLabel) {
        statusLabel.innerHTML = statusText;
    }
}

function setTransferPausedUI(id, isPaused) {
    const item = document.getElementById(`transfer-${id}`);
    const btn = document.getElementById(`btn-pause-${id}`);
    const statusLabel = document.getElementById(`status-label-${id}`);
    
    if (!item || !btn) return;
    
    if (isPaused) {
        item.classList.remove('active');
        item.classList.add('paused');
        btn.classList.add('is-paused');
        btn.innerHTML = `<i class="fa-solid fa-play"></i>`;
        btn.title = "Resume";
        if (statusLabel) {
            statusLabel.innerHTML = `<i class="fa-solid fa-pause" style="color: #f59e0b;"></i> Gate Paused`;
        }
    } else {
        item.classList.remove('paused');
        item.classList.add('active');
        btn.classList.remove('is-paused');
        btn.innerHTML = `<i class="fa-solid fa-pause"></i>`;
        btn.title = "Pause";
        const transfer = activeTransfers[id];
        if (transfer && statusLabel) {
            const icon = transfer.type === 'upload' ? 'fa-arrow-up-from-bracket' : 'fa-arrow-down';
            const typeLabel = transfer.type === 'upload' ? 'Uploading...' : 'Downloading...';
            statusLabel.innerHTML = `<i class="fa-solid fa-${icon}"></i> ${typeLabel}`;
        }
    }
}

function removeTransferItemUI(id) {
    const item = document.getElementById(`transfer-${id}`);
    if (item && item.parentNode) {
        item.parentNode.removeChild(item);
    }
    updateTransfersCardVisibility();
}

async function toggleTransfer(id) {
    const transfer = activeTransfers[id];
    if (!transfer) return;
    
    if (transfer.paused) {
        playTransferSound('resume');
        transfer.paused = false;
        setTransferPausedUI(id, false);
        
        if (transfer.type === 'upload') {
            try {
                updateTransferProgressUI(id, Math.round((transfer.offset / transfer.size) * 100), `<i class="fa-solid fa-spinner fa-spin"></i> Resuming Gate...`);
                await ensureValidToken();
                
                const queryXhr = new XMLHttpRequest();
                queryXhr.open('PUT', transfer.uploadUrl, true);
                queryXhr.setRequestHeader('Content-Range', `bytes */${transfer.size}`);
                
                queryXhr.onload = async () => {
                    if (queryXhr.status === 308) {
                        const rangeHeader = queryXhr.getResponseHeader('Range');
                        if (rangeHeader) {
                            const match = rangeHeader.match(/bytes=0-(\d+)/);
                            if (match) {
                                transfer.offset = parseInt(match[1]) + 1;
                            }
                        } else {
                            transfer.offset = 0;
                        }
                        await runUploadFlow(id);
                    } else if (queryXhr.status === 200 || queryXhr.status === 201) {
                        updateTransferProgressUI(id, 100, `<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> Completed`);
                        playTransferSound('success');
                        setTimeout(() => {
                            removeTransfer(id);
                            fetchFiles();
                        }, 1500);
                    } else {
                        transfer.offset = 0;
                        await runUploadFlow(id);
                    }
                };
                queryXhr.onerror = async () => {
                    await runUploadFlow(id);
                };
                queryXhr.send();
            } catch (err) {
                console.error("Resume upload failed:", err);
                showToast("Failed to resume upload.", "error");
            }
        } else {
            runDownloadFlow(id);
        }
    } else {
        playTransferSound('pause');
        transfer.paused = true;
        setTransferPausedUI(id, true);
        if (transfer.xhr) {
            transfer.xhr.abort();
        }
    }
}

async function cancelTransfer(id) {
    const transfer = activeTransfers[id];
    if (!transfer) return;
    
    if (!confirm(`Are you sure you want to cancel '${transfer.fileName}'?`)) return;
    
    playTransferSound('cancel');
    transfer.canceled = true;
    
    if (transfer.xhr) {
        transfer.xhr.abort();
    }
    
    if (transfer.type === 'upload' && transfer.uploadUrl) {
        try {
            await ensureValidToken();
            fetch(transfer.uploadUrl, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }).catch(e => console.log("Google session cleanup skipped:", e));
        } catch (e) {}
    }
    
    showToast(`Transfer canceled: ${transfer.fileName}`, "info");
    removeTransfer(id);
}

function removeTransfer(id) {
    delete activeTransfers[id];
    removeTransferItemUI(id);
}

function triggerNativeDownload(fileId, fileName, mimeType) {
    let downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&access_token=${accessToken}`;
    
    const googleMimeTypeExports = {
        'application/vnd.google-apps.document': {
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ext: 'docx'
        },
        'application/vnd.google-apps.spreadsheet': {
            mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ext: 'xlsx'
        },
        'application/vnd.google-apps.presentation': {
            mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            ext: 'pptx'
        },
        'application/vnd.google-apps.drawing': {
            mime: 'image/png',
            ext: 'png'
        }
    };

    if (mimeType && googleMimeTypeExports[mimeType]) {
        const exportConfig = googleMimeTypeExports[mimeType];
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportConfig.mime)}&access_token=${accessToken}`;
        if (!fileName.toLowerCase().endsWith('.' + exportConfig.ext)) {
            fileName = `${fileName}.${exportConfig.ext}`;
        }
    }
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("Download triggered in browser manager!", "success");
}

function getFileIconClass(mimeType, name) {
    if (!mimeType) return 'fa-regular fa-file';
    const ext = name.split('.').pop().toLowerCase();
    
    if (mimeType.includes('folder')) return 'fa-regular fa-folder-closed';
    if (mimeType.includes('image') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'fa-regular fa-file-image';
    if (mimeType.includes('video') || ['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return 'fa-regular fa-file-video';
    if (mimeType.includes('audio') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'fa-regular fa-file-audio';
    if (mimeType.includes('pdf') || ext === 'pdf') return 'fa-regular fa-file-pdf';
    
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        return 'fa-regular fa-file-zipper';
    }
    if (mimeType.includes('text') || ['txt', 'md', 'html', 'css', 'js', 'json'].includes(ext)) {
        return 'fa-regular fa-file-lines';
    }
    if (mimeType.includes('spreadsheet') || ['xls', 'xlsx', 'csv'].includes(ext)) {
        return 'fa-regular fa-file-excel';
    }
    if (mimeType.includes('presentation') || ['ppt', 'pptx'].includes(ext)) {
        return 'fa-regular fa-file-powerpoint';
    }
    if (mimeType.includes('word') || ['doc', 'docx'].includes(ext)) {
        return 'fa-regular fa-file-word';
    }
    return 'fa-regular fa-file';
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === "0" || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.transform = 'translateX(120%)';
        toast.style.opacity = '0';
        setTimeout(() => {
            container.removeChild(toast);
        }, 300);
    }, 4000);
}

// ==========================================
// SOLO LEVELING HUNTER RANK SYSTEM
// ==========================================

let localFileCount = 0;
let localStorageUsed = 0;

function syncHunterStats() {
    updateHunterRank(localFileCount, localStorageUsed);
}

function updateHunterRank(fileCount, bytesUsed) {
    const username = sessionStorage.getItem('custom_username') || 'AURA';
    const formattedName = username.charAt(0).toUpperCase() + username.slice(1);
    
    const nameEl = document.getElementById('hunterNameText');
    if (nameEl) nameEl.textContent = formattedName;

    // Hunter leveling arpeggio formula
    const totalVal = Math.sqrt(fileCount * 4) + Math.sqrt(bytesUsed / (1024 * 1024 * 5));
    const calculatedLvl = Math.max(1, Math.min(99, Math.floor(totalVal) + 1));
    const xpPercent = Math.round((totalVal - Math.floor(totalVal)) * 100);

    // Rank configuration
    let rank = 'E';
    let title = "Mankind's Weakest Hunter";
    let iconClass = "fa-solid fa-skull-crossbones";
    let color = "#9ca3af";

    if (calculatedLvl >= 6 && calculatedLvl <= 15) {
        rank = 'D';
        title = "Raid Dungeon Porter";
        iconClass = "fa-solid fa-shield-halved";
        color = "#10b981";
    } else if (calculatedLvl >= 16 && calculatedLvl <= 30) {
        rank = 'C';
        title = "Strike Force Member";
        iconClass = "fa-solid fa-user-ninja";
        color = "#3b82f6";
    } else if (calculatedLvl >= 31 && calculatedLvl <= 50) {
        rank = 'B';
        title = "Elite Raid Team Leader";
        iconClass = "fa-solid fa-wand-magic-sparkles";
        color = "#8b5cf6";
    } else if (calculatedLvl >= 51 && calculatedLvl <= 75) {
        rank = 'A';
        title = "Guild Vice-Master";
        iconClass = "fa-solid fa-bolt";
        color = "#f59e0b";
    } else if (calculatedLvl >= 76) {
        rank = 'S';
        title = "Shadow Monarch / S-Rank";
        iconClass = "fa-solid fa-crown";
        color = "#00f0ff";
    }

    // Update HTML elements safely
    const levelEl = document.getElementById('hunterLevelText');
    const filesEl = document.getElementById('hunterFilesText');
    const manaEl = document.getElementById('hunterManaText');
    const xpPercentEl = document.getElementById('hunterExpPercentText');
    const xpBarFillEl = document.getElementById('hunterExpBarFill');
    const titleEl = document.getElementById('hunterTitleText');
    const rankBadgeEl = document.getElementById('hunterRankBadge');
    const avatarIconEl = document.getElementById('hunterAvatarIcon');
    const hunterCardEl = document.getElementById('hunterCard');

    if (levelEl) levelEl.textContent = `Lv. ${calculatedLvl}`;
    if (filesEl) filesEl.textContent = fileCount;
    if (manaEl) manaEl.textContent = formatBytes(bytesUsed);
    if (xpPercentEl) xpPercentEl.textContent = `${xpPercent}%`;
    if (xpBarFillEl) xpBarFillEl.style.width = `${xpPercent}%`;
    if (titleEl) titleEl.textContent = title;
    if (rankBadgeEl) rankBadgeEl.textContent = rank;

    if (avatarIconEl) {
        avatarIconEl.className = `${iconClass} hunter-avatar-icon`;
        avatarIconEl.style.color = color;
        avatarIconEl.style.textShadow = `0 0 10px ${color}`;
    }

    if (hunterCardEl) {
        hunterCardEl.className = `card glassmorphic hunter-card rank-${rank}`;
    }

    // Check for level or rank up!
    const savedLvl = parseInt(localStorage.getItem('hunter_level') || '1');
    const savedRank = localStorage.getItem('hunter_rank') || 'E';

    // Set defaults if they don't exist
    if (!localStorage.getItem('hunter_level')) {
        localStorage.setItem('hunter_level', calculatedLvl);
        localStorage.setItem('hunter_rank', rank);
        return;
    }

    if (calculatedLvl > savedLvl) {
        triggerLevelUpScreen(calculatedLvl, rank, rank !== savedRank);
        localStorage.setItem('hunter_level', calculatedLvl);
        localStorage.setItem('hunter_rank', rank);
    }
}

function triggerLevelUpScreen(level, rank, didRankUp) {
    const overlayLvl = document.getElementById('overlayLevelText');
    const overlayRank = document.getElementById('overlayRankText');
    const overlay = document.getElementById('levelUpOverlay');

    if (overlayLvl) overlayLvl.textContent = `Lv. ${level}`;
    if (overlayRank) overlayRank.textContent = didRankUp ? `Rank ${rank} Increased! ⚡` : `Power Level Increased!`;
    if (overlay) overlay.style.display = 'flex';
    
    playLevelUpSound();
}

function closeLevelUpOverlay() {
    const overlay = document.getElementById('levelUpOverlay');
    if (overlay) overlay.style.display = 'none';
}

function playLevelUpSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Chime notes: C4, E4, G4, C5 (major arpeggio)
        const notes = [261.63, 329.63, 392.00, 523.25];
        const duration = 0.15; // note duration
        
        notes.forEach((freq, index) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime + index * duration);
            
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime + index * duration);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + index * duration + duration);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.start(audioCtx.currentTime + index * duration);
            osc.stop(audioCtx.currentTime + index * duration + duration);
        });
    } catch (e) {
        console.error("Audio failed to play:", e);
    }
}

/* ==========================================
   GATES OF SHARING (SECURE LINK SHARING)
   ========================================== */

function openCreateShareModal(fileId, fileName, fileSize) {
    document.getElementById('shareFileId').value = fileId;
    document.getElementById('shareFileName').value = fileName;
    document.getElementById('shareFileSize').value = fileSize;

    document.getElementById('shareModalFileName').textContent = fileName;
    document.getElementById('shareModalFileSize').textContent = formatBytes(fileSize);

    // Reset inputs
    document.getElementById('sharePasswordOption').value = '';
    document.getElementById('shareExpiryOption').value = '0';
    document.getElementById('shareLimitOption').value = '0';

    document.getElementById('createShareModal').style.display = 'flex';
}

function closeShareModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

async function handleShareSubmit(event) {
    event.preventDefault();
    showLoading(true);

    const fileId = document.getElementById('shareFileId').value;
    const fileName = document.getElementById('shareFileName').value;
    const fileSize = parseInt(document.getElementById('shareFileSize').value || '0');
    const passwordProtection = document.getElementById('sharePasswordOption').value.trim();
    const expiresHours = parseInt(document.getElementById('shareExpiryOption').value);
    const maxDownloads = parseInt(document.getElementById('shareLimitOption').value);

    const username = sessionStorage.getItem('custom_username');
    const password = sessionStorage.getItem('custom_password');

    try {
        const response = await fetch('/api/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                action: 'create',
                fileId,
                fileName,
                fileSize,
                passwordProtection: passwordProtection || null,
                expiresHours,
                maxDownloads: maxDownloads || null
            })
        });

        const data = await response.json();
        showLoading(false);

        if (!response.ok) {
            showToast(data.error || "Failed to create access gate link.", "error");
            return;
        }

        // Close form modal
        closeShareModal('createShareModal');

        // Generate full public share URL
        const shareUrl = `${window.location.origin}/share.html?id=${data.shareId}`;

        // Prompt user to copy
        showShareLinkPrompt(shareUrl, fileName);

    } catch (err) {
        console.error(err);
        showLoading(false);
        showToast("Network connection error.", "error");
    }
}

function showShareLinkPrompt(shareUrl, fileName) {
    // Generate a sleek copy dialog modal using custom alerts or prompt
    const tempInput = document.createElement('input');
    document.body.appendChild(tempInput);
    tempInput.value = shareUrl;
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);

    // Audio chime cue
    playTransferSound('success');

    // Display custom modal alert
    alert(`Access Gate Created for: ${fileName}\n\nThe secure sharing link has been copied to your clipboard:\n\n${shareUrl}`);
}

async function loadActiveShares() {
    const listContainer = document.getElementById('activeSharesList');
    const loader = document.getElementById('sharesLoadingIndicator');
    const emptyState = document.getElementById('sharesEmptyState');
    const container = document.getElementById('sharesListContainer');

    listContainer.innerHTML = '';
    loader.style.display = 'block';
    emptyState.style.display = 'none';
    container.style.display = 'none';

    const username = sessionStorage.getItem('custom_username');
    const password = sessionStorage.getItem('custom_password');

    try {
        const response = await fetch('/api/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, action: 'list' })
        });

        const data = await response.json();
        loader.style.display = 'none';

        if (!response.ok) {
            showToast(data.error || "Failed to load sharing links.", "error");
            return;
        }

        const shares = data.shares || {};
        const sids = Object.keys(shares);

        if (sids.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        container.style.display = 'block';
        sids.forEach(sid => {
            const share = shares[sid];
            const row = document.createElement('div');
            row.className = 'share-row';

            const shareUrl = `${window.location.origin}/share.html?id=${sid}`;

            // Expiry label
            let expiryText = 'Never Expires';
            if (share.expiresAt) {
                const diff = share.expiresAt - Date.now();
                if (diff > 0) {
                    const hrs = Math.ceil(diff / (60 * 60 * 1000));
                    expiryText = `Expires in ${hrs}h`;
                } else {
                    expiryText = 'Expired';
                }
            }
            if (share.firstDownloadAt) {
                const diff = (share.firstDownloadAt + 15 * 60 * 1000) - Date.now();
                if (diff > 0) {
                    const mins = Math.ceil(diff / (60 * 1000));
                    expiryText = `Grace window: ${mins}m left`;
                } else {
                    expiryText = 'Expired (Window)';
                }
            }

            row.innerHTML = `
                <div class="share-row-info">
                    <div class="share-row-name" title="${share.fileName}">${share.fileName}</div>
                    <div class="share-row-meta">
                        <span><i class="fa-solid fa-hard-drive"></i> ${formatBytes(share.fileSize)}</span>
                        <span><i class="fa-solid fa-clock"></i> ${expiryText}</span>
                        ${share.password ? '<span><i class="fa-solid fa-key"></i> Key Active</span>' : ''}
                        ${share.maxDownloads ? `<span><i class="fa-solid fa-download"></i> 1-Time Gate</span>` : ''}
                    </div>
                </div>
                <div class="share-row-actions">
                    <button class="btn btn-icon btn-share-manager" onclick="copyToClipboard('${shareUrl}')" title="Copy sharing link">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                    <button class="btn btn-icon btn-action btn-delete" onclick="revokeShare('${sid}')" title="Revoke sharing gate" style="background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--accent-red); padding: 4px 8px; border-radius: 6px;">
                        <i class="fa-solid fa-ban"></i>
                    </button>
                </div>
            `;
            listContainer.appendChild(row);
        });

    } catch (err) {
        console.error(err);
        loader.style.display = 'none';
        showToast("Error loading active links.", "error");
    }
}

async function revokeShare(shareId) {
    if (!confirm("Are you sure you want to permanently revoke this access gate link? It will no longer work for anyone.")) {
        return;
    }

    showLoading(true);
    const username = sessionStorage.getItem('custom_username');
    const password = sessionStorage.getItem('custom_password');

    try {
        const response = await fetch('/api/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, action: 'delete', shareId })
        });

        showLoading(false);
        if (!response.ok) {
            const data = await response.json();
            showToast(data.error || "Failed to revoke share.", "error");
            return;
        }

        showToast("Access gate revoked successfully.", "success");
        loadActiveShares(); // Refresh the list

    } catch (err) {
        console.error(err);
        showLoading(false);
        showToast("Error communicating with server.", "error");
    }
}

function copyToClipboard(text) {
    const tempInput = document.createElement('input');
    document.body.appendChild(tempInput);
    tempInput.value = text;
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    showToast("Sharing link copied to clipboard!", "success");
}
