# LuckAI Startup Script
# Plain setup: checks dependencies, installs if needed, and starts the server

Write-Host "LuckAI Startup Script"
Write-Host "====================="
Write-Host ""

# Check if Node.js is installed
Write-Host "[1/4] Checking Node.js installation..."
$nodeCheck = node -v 2>$null
if ($nodeCheck) {
    Write-Host "[OK] Node.js found: $nodeCheck"
} else {
    Write-Host "[ERROR] Node.js not found. Please install Node.js from https://nodejs.org/"
    exit 1
}

# Check if npm is installed
Write-Host "[2/4] Checking npm installation..."
$npmCheck = npm -v 2>$null
if ($npmCheck) {
    Write-Host "[OK] npm found: $npmCheck"
} else {
    Write-Host "[ERROR] npm not found. Please install Node.js."
    exit 1
}

# Check if Python is installed (needed for node-llama-cpp)
Write-Host "[2.5/4] Checking Python installation..."
$pythonCheck = python --version 2>$null
if ($pythonCheck) {
    Write-Host "[OK] Python found: $pythonCheck"
} else {
    Write-Host "[WARN] Python not found. node-llama-cpp may fail to compile."
    Write-Host "[WARN] Please install Python from https://www.python.org/downloads/"
}

# Install dependencies if needed
Write-Host "[3/4] Installing dependencies..."
if (Test-Path "node_modules") {
    Write-Host "[OK] node_modules already exists"
} else {
    Write-Host "[INFO] Running npm install..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npm install failed"
        Write-Host ""
        Write-Host "TROUBLESHOOTING:"
        Write-Host "- Ensure Visual Studio Build Tools are installed (for C++ compilation)"
        Write-Host "- See SETUP_WINDOWS.md for detailed setup instructions"
        exit 1
    }
    Write-Host "[OK] Dependencies installed"
}

# Start the server
Write-Host "[4/4] Starting LuckAI server..."
Write-Host ""
node server.js
