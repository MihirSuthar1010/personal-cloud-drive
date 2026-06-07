# Mihir's Private Cloud ☁️ (Vercel Serverless Version)

A sleek, premium, dark-themed personal cloud storage dashboard that connects directly to your **5 TB Google Drive**.
This version uses a **Serverless Backend** (via Vercel Serverless Functions) so that you only need to log in with a custom **Username and Password** on your devices. You will **never** see a Google popup or login screen on your office PC or phone!

---

## 🛠️ Step-by-Step Setup Guide

### STEP 1: Get Google Credentials (if you haven't already)
If you already did this in the previous step, you can use the same Client ID and Client Secret. Otherwise:
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project named `Mihir Private Cloud`.
3. Search for **Google Drive API** and click **Enable**.
4. Go to **Audience** (or **OAuth consent screen**) in the left sidebar:
   * Select **External**, name it `Mihir Private Cloud`, set your email, and save.
   * Add the scope `drive.file` (View and manage Google Drive files that you open/create with this app).
   * In the **Test users** section, add your Gmail address: `mihirsuthar.tec@gmail.com`.
5. Go to **Credentials**:
   * Click **+ Create Credentials** > **OAuth Client ID** > **Web Application**.
   * Under **Authorized JavaScript origins**, click **+ Add URI** and add:
     - `http://localhost:3000`
     - `https://mihirlocker.vercel.app` (your Vercel website link)
6. Click **Create** and copy both the **Client ID** and the **Client Secret**.

---

### STEP 2: Generate the Google Refresh Token (One-time only)
To get the permanent Google Drive "Key" for your Vercel server:
1. Double-click the file **[setup.html](file:///C:/Users/mihir/OneDrive/Desktop/personal-cloud-drive/setup.html)** in your project folder to open it in your browser.
2. Paste your **Google Client ID** and **Google Client Secret** into the form.
3. Click **Authorize & Generate Key**.
4. A Google login popup will appear. Log in and allow the permissions (click "Continue" on the unverified screen if it appears).
5. Copy the green code block that appears on the setup page. This is your **Refresh Token**.
6. *(Optional)* After copying, you can delete `setup.html` from your computer for security.

---

### STEP 3: Setup Environment Variables in Vercel
This is where we tell Vercel what your custom credentials and Google keys are:

1. Open your Vercel Dashboard and click on your **`mihirlocker`** project.
2. Go to **Settings** > **Environment Variables** (in the tab menu).
3. Add the following 5 variables:

| Key | Value | Description |
| :--- | :--- | :--- |
| **`CUSTOM_USERNAME`** | *Choose any username* (e.g. `mihir`) | The username you will type to log into your site. |
| **`CUSTOM_PASSWORD`** | *Choose any password* | The password you will type to log into your site. |
| **`GD_CLIENT_ID`** | *Your Google Client ID* | The client ID from Google Cloud Console. |
| **`GD_CLIENT_SECRET`** | *Your Google Client Secret* | The client secret from Google Cloud Console. |
| **`GD_REFRESH_TOKEN`** | *Your Google Refresh Token* | The token generated from `setup.html`. |

4. Click **Save** to apply the changes.

---

### STEP 4: Deploy the Project to Vercel
Since this repository is connected to Vercel:
1. Any code changes pushed to the `main` branch of your GitHub repository will automatically trigger a new deployment on Vercel.
2. Once deployed, open your Vercel URL (e.g., `https://mihirlocker.vercel.app`).
3. Type your custom username and password, click **Unlock Cloud Drive**, and enjoy your 100% private 24/7 personal cloud storage!
