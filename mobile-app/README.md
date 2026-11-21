# Indian Battle Fields – Android app

`IndianBattleFields.apk` is a full-screen, landscape Android app that opens the
game from the game server (the 3D web client at `/play/3d.html`).

## Which server it connects to

Set in `capacitor.config.json` → `server.url`. Currently:

    http://192.168.0.131:5000/play/3d.html

That is this PC on the home Wi-Fi, so the phone must be on the same Wi-Fi,
the server must be running, and Windows Firewall must allow port 5000.
After hosting the server online, change the URL to the hosted
`https://…/play/3d.html` address and rebuild.

## Rebuild the APK (Git Bash)

    cd mobile-app
    npx cap sync android
    cd android
    export JAVA_HOME="/c/Program Files/Java/jdk-17"
    # Avast inspects HTTPS; let Java use the Windows certificate store.
    export JAVA_TOOL_OPTIONS="-Djavax.net.ssl.trustStoreType=Windows-ROOT"
    ./gradlew assembleDebug
    cp app/build/outputs/apk/debug/app-debug.apk ../IndianBattleFields.apk

This is a debug build: fine for installing on your own phones, not for the
Play Store (that needs a signed release build).
