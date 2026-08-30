<img src="images/Meshery.iconset/icon_128x128@2x.png" width="128" height="128" />

Meshery is OpenGolfSim's all-in-one course building tool. It makes creating real-world or fictional courses quick and easy.

Head over to our [Course Building Guide](https://help.opengolfsim.com/course-building/) in our help docs to learn more.


## Logs:

- MacOS: `~/Library/Logs/ogs-meshery/main.log`
- Windows: `%USERPROFILE%/AppData/Roaming/ogs-meshery/main.log`

### Debugging via Logs

You can live tail the logs on windows using the following command:
```powershell
Get-Content "$env:USERPROFILE\AppData\Roaming\ogs-meshery\logs\main.log" -Wait -Tail 30
```

## Development

You can checkout this repo and run the project locally.

```bash
git checkout https://github.com/OpenGolfSim/course-meshery-tool.git

cd course-meshery-tool

npm install

npm start
```


To tag a new release, make sure you are on the main branch and run the following

```bash
npm version patch
# or
npm version minor
# or
npm version major

# then push main
git push origin main
# then push and the version tag
git push origin vx.x.x
```


To manually install/unpack python tools:
```bash
mkdir myenv
tar -xf example.tar.gz -C myenv
cd myenv
./bin/conda-unpack 
```


## FUSE

We install `@opengolfsim/fuse` as an npm module dependency.

To install from the production/main branch:

```bash
npm install github:opengolfsim/fuse
```

To install from a specific fork or branch:

```bash
npm install github:opengolfsim/fuse#feat/branch-name
```
