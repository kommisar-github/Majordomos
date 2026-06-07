@echo off
rem Task Router client shim (Windows). Forwards to client.js via node.
node "%~dp0client.js" %*
