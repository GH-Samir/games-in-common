const path = require('path');
const { app, BrowserWindow } = require('electron');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const PORT = 34115;

process.env.CONFIG_DIR = app.getPath('userData');
process.env.PORT = String(PORT);
process.env.BASE_URL = `http://localhost:${PORT}`;

let mainWindow;

function createWindow(baseUrl) {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Games in Common',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = CHROME_UA;
    callback({ requestHeaders: details.requestHeaders });
  });

  mainWindow.loadURL(baseUrl);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const { startServer } = require(path.join(__dirname, '..', 'server.js'));
    const { baseUrl } = await startServer({ port: PORT });
    createWindow(baseUrl);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
