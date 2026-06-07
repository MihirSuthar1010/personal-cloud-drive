/**
 * ==========================================
 * MIHIR'S PRIVATE CLOUD - CLIENT JS (SERVERLESS)
 * ==========================================
 */

// Target folder name in Google Drive
const TARGET_FOLDER_NAME = 'Mihir_Privet_Cloud';

// Global State
let accessToken = null;
let tokenExpiryTime = 0; // Epoch timestamp in ms
let currentFolderId = sessionStorage.getItem('gdrive_folder_id') || null;
let allFiles = []; // To keep track of listed files for search filters

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
            // Saved credentials are invalid (e.g. user changed password on Netlify)
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

// Contacts Netlify serverless auth endpoint to retrieve a fresh Google token
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
            showToast("Mihir_Privet_Cloud directory loaded.", "info");
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
        renderFileList(allFiles);
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

// Upload file directly to Google Drive via Client Side Resumable Upload
async function handleFileUploads(files) {
    if (!currentFolderId) {
        showToast("Cloud directory is not initialized.", "error");
        return;
    }

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        showUploadProgress(true, file.name);
        
        try {
            await ensureValidToken();

            // Step 1: Request resumable session from Google Drive API
            const metadata = {
                name: file.name,
                parents: [currentFolderId]
            };

            const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Upload-Content-Type': file.type || 'application/octet-stream',
                    'X-Upload-Content-Length': file.size
                },
                body: JSON.stringify(metadata)
            });

            if (!response.ok) throw new Error("Initiation failed");

            const uploadUrl = response.headers.get('Location');
            if (!uploadUrl) throw new Error("Google did not return upload URI");

            // Step 2: Upload the raw binary stream with XMLHttpRequests to track progress percentage
            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('PUT', uploadUrl, true);
                xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        updateProgressBar(percent);
                    }
                };

                xhr.onload = () => {
                    if (xhr.status === 200 || xhr.status === 201) {
                        resolve(JSON.parse(xhr.responseText));
                    } else {
                        reject(new Error("File chunk upload failed"));
                    }
                };

                xhr.onerror = () => reject(new Error("Network connection error"));
                xhr.send(file);
            });

            showToast(`Uploaded successfully: ${file.name}`, "success");
        } catch (error) {
            console.error("Upload failed: ", error);
            showToast(`Upload failed: ${file.name}`, "error");
        } finally {
            showUploadProgress(false);
        }
    }
    
    fetchFiles();
}

// Delete file from the cloud folder
async function deleteFile(fileId, fileName) {
    if (!confirm(`Are you sure you want to delete '${fileName}'?`)) return;
    
    try {
        await ensureValidToken();

        let response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (response.ok) {
            showToast(`Deleted successfully: ${fileName}`, "success");
            fetchFiles();
        } else {
            throw new Error("Delete API call failed");
        }
    } catch (err) {
        console.error("Delete failed: ", err);
        showToast("Failed to delete file.", "error");
    }
}

// Handle Direct Download via access_token (works without Google cookies)
async function downloadFile(fileId) {
    const file = allFiles.find(f => f.id === fileId);
    const fileName = file ? file.name : "download";
    
    showToast("Starting download...", "info");
    try {
        await ensureValidToken();
        
        let response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (!response.ok) throw new Error("Failed to download file data");
        
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
        
        showToast("Download complete!", "success");
    } catch (err) {
        console.error("Download failed: ", err);
        showToast("Download failed. Please try again.", "error");
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

function showUploadProgress(isUploading, name = '') {
    if (isUploading) {
        uploadProgressContainer.style.display = 'block';
        uploadingFileName.textContent = `Uploading: ${name}`;
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
    // Custom Login Form Listener
    loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const user = document.getElementById('customUsername').value.trim();
        const pass = document.getElementById('customPassword').value.trim();
        handleCustomLogin(user, pass);
    });

    logoutBtn.addEventListener('click', handleLogout);
    refreshBtn.addEventListener('click', fetchFiles);

    // Search filter
    searchInput.addEventListener('input', function (e) {
        const query = e.target.value.toLowerCase();
        const filtered = allFiles.filter(f => f.name.toLowerCase().includes(query));
        renderFileList(filtered);
    });

    // Drag and Drop Zone Config
    dropZone.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) {
            handleFileUploads(e.target.files);
        }
    });

    dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', function () {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            handleFileUploads(e.dataTransfer.files);
        }
    });
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
