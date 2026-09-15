@echo off
cd /d c:\Users\Moshe\Desktop\custom-projects\White-glove\infra
npx cdk deploy --all --require-approval never -c providerSoftLiveBot=true -c providerSoftUseStubs=false -c hhaUseMock=false -c alertEmails=elefkowitz@whiteglovecare.net,moshe@advancedautomations.net,ggreenfeld@whiteglovecare.net,alowy@whiteglovecare.net,gfriedman@whiteglovecare.net -c alertFromEmail=alerts@advancedautomations.net -c alertFromDomain=advancedautomations.net > cdk-alias-hyphen-redeploy-out.txt 2> cdk-alias-hyphen-redeploy-err.txt
echo EXIT=%ERRORLEVEL% > cdk-alias-hyphen-redeploy-exit.txt
