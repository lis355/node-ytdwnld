# node-ytdwnld

Application to download youtube videos as audio and upload/save to Filesystem/FTP

## Install

```
yarn install
yarn run installApp -- it will create ytdwnld.bat start file in C:\Windows
```

```
          __      __               __    __
   __  __/ /_____/ /      ______  / /___/ /
  / / / / __/ __  / | /| / / __ \/ / __  /
 / /_/ / /_/ /_/ /| |/ |/ / / / / / /_/ /
 \__, /\__/\__,_/ |__/|__/_/ /_/_/\__,_/
/____/                          v 4.2.0

Usage: node-ytdwnld [options] [command]

Application to download youtube videos as audio and upload/save to Filesystem/FTP

Options:
  -V, --version                  output the version number
  -h, --help                     display help for command

Commands:
  config                         Open config file
  download [options] <items...>  Download media from YouTube
  bot                            Start telegram bot to download videos
  help [command]                 display help for command
```

Set up your config
```
ytdwnld config -- will open config.yaml file
```

Set `outputDirectory` in config, you can use
- file system directory like `C:/Podcasts`
- ftp server like `ftp://192.168.1.104:21/Podcasts`

Use in command line like
```
ytdwnld youtubeLink1 youtubeLink2 ...
```

It will download video, convert it to audio, split to chapters and upload to `outputDirectory/VIDEO_NAME`

## Using on Android

I recommend you to use `WiFi FTP Server` on Android Phone to upload podcasts [(Google Play)](https://play.google.com/store/apps/details?id=com.medhaapps.wififtpserver)

And `Smart AudioBook Player` to play your podcasts [(Google Play)](https://play.google.com/store/apps/details?id=ak.alizandro.smartaudiobookplayer)