import axios from "axios";
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'fs';
import ProgressBar from 'progress';
import { exec } from 'child_process'

const loadCookies = (path) => {
    try {
        const data = fs.readFileSync(path, 'utf-8');
        const cookiesArray = data.split('\n').map(line => line.trim()).filter(line => line);

        return cookiesArray.join('; ');
    } catch (error) {
        console.log(`[WARNING] Cookies not Found \n`);
        return '';
    }
};

const getVideoId = (url) => {
    const parsedUrl = new URL(url);
    const pathSplit = parsedUrl.pathname.split('/');

    if (url.includes('/video/')) {
        const videoIndex = pathSplit.indexOf('video');
        return pathSplit[videoIndex + 1];
    } else if (url.includes('/play/')) {
        const numberAfterPlay = pathSplit.filter(segment => /^\d+$/.test(segment));

        if (numberAfterPlay.length >= 2) {
            return numberAfterPlay[1];
        } else if (numberAfterPlay.length === 1) {
            console.log('Only one number found after /play/. That value will be used.');
            return numberAfterPlay[0];
        } else {
            console.log('Not enough numbers found after /play/');
            return null;
        }
    } else {
        console.log('Unsupported link type.');
        return null;
    }
};

const fetchVideoInfo = async (videoId) => {
    const regexVideo = /^\d{4,8}$/
    let urlApi;

    if (regexVideo.test(videoId)) {
        urlApi = `https://api.bilibili.tv/intl/gateway/web/playurl?ep_id=${videoId}&device=wap&platform=web&qn=64&tf=0&type=0`;
    } else {
        urlApi = `https://api.bilibili.tv/intl/gateway/web/playurl?s_locale=en_US&platform=web&aid=${videoId}&qn=120`;
    }

    let results = {
        videos: [],
        audio: null,
    };

    try {
        const request = await axios.get(urlApi, { credentials: "include" });
        const response = request.data;

        if (!response || !response.data || !response.data.playurl) {
            console.log('Server response does not contain the expected structure.');
            return null;
        }

        for (const videoInfo of response.data.playurl.video) {
            const videoResource = videoInfo.video_resource || {};
            const streamInfo = videoInfo.stream_info || {};

            if (videoResource.url.trim() !== '') {
                results.videos.push({
                    desc: streamInfo.desc_words,
                    url: videoResource.url,
                })
            }
        }

        const audioInfoList = response.data.playurl.audio_resource || [];

        if (audioInfoList.length > 0) {
            const audioInfo = audioInfoList[0];
            results.audio = audioInfo.url;
        }

        if (results.audio !== null && results.videos.length !== 0) {
            return results;
        } else {
            console.log(`URL for video or audio with quality ${quality} or 64 not found..`);
            return null;
        }
    } catch (error) {
        console.log(`Error getting video and audio URL: ${error.message}`);
        return null;
    }

};

const downloadFile = async (downloadUrl, fileName) => {
    try {
        const response = await axios.get(downloadUrl, { responseType: 'stream' });

        const totalBytes = parseInt(response.headers['content-length'], 10);
        let receivedBytes = 0;
        let lastReceivedBytes = 0;

        const bar = new ProgressBar(`Downloading ${fileName} [:bar] :percent :etas`, {
            complete: '=',
            incomplete: ' ',
            width: 20,
            total: totalBytes
        });

        const writableStream = fs.createWriteStream(fileName);

        response.data.on('data', (chunk) => {
            receivedBytes += chunk.length;
            bar.tick(chunk.length);
            lastReceivedBytes = receivedBytes;
        });

        response.data.pipe(writableStream);

        await new Promise((resolve, reject) => {
            writableStream.on('finish', resolve);
            writableStream.on('error', reject);
        });

        console.log(`File downloaded as:  ${fileName} \n`);
        return fileName;
    } catch (error) {
        console.error(`Error during file download:  ${error.message}`);
        return null;
    }
};

const deleteFile = async (fileName) => {
    try {
        await fs.promises.unlink(fileName);
    } catch (error) {
        console.log(`Error deleting file ${fileName}: ${error}`);
    }
};

const executeCommandLine = async (comando) => {
    return new Promise((resolve, reject) => {
        exec(comando, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing command: ${error.message}`);
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
};

async function getUserInput(question) {
    const rl = readline.createInterface({ input, output });

    try {
        const answer = await rl.question(question);
        return answer;
    } catch (err) {
        console.error('Error getting input:', err);
        return null;
    } finally {
        rl.close();
    }
}

async function main() {
    console.log("[INFO] Loading Cookies ")
    const cookies = loadCookies('./cookies.txt');

    axios.defaults.headers = {
        referer: 'https://www.bilibili.tv/',
        cookie: cookies,
    };

    console.log("[INFO] Input full url")
    const inputUrl = await getUserInput("[INPUT] Gimme Link : ");

    console.log("[INFO] Extracting Video ID")
    const videoId = getVideoId(inputUrl);
    if (!videoId) {
        console.log("[ERROR] Invalid videoId");
        return;
    }

    console.log(`[INFO] Got VideoID ${videoId}`);
    console.log(`[INFO] Fetching Video Info...`);
    const videoInfo = await fetchVideoInfo(videoId);
    if (!videoId) {
        console.log("[ERROR] Invalid videoInfo");
        return;
    }

    let videoUrl = null;
    let videoQuality = null;
    const audioUrl = videoInfo.audio;

    console.log("\n[INFO] Available Quality : \n")
    for (let i = 0; i < (videoInfo.videos.length - 1); i++) {
        console.log(`${i}. ${videoInfo.videos[i].desc}`)
    }

    const choseQualityIndex = await getUserInput("\n[INPUT] Select Quality Index : (ex: 1) \n");
    if (!choseQualityIndex) {
        console.log("[ERROR] Invalid choseQualityIndex");
        return;
    }

    const selectedVideoQuality = videoInfo.videos[choseQualityIndex];
    videoUrl = selectedVideoQuality.url;
    videoQuality = selectedVideoQuality.desc;

    const directoryPath = './Downloads';
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath);
    }

    const fileName = `${videoId}_${videoQuality}`;
    const videoFileName = `${directoryPath}/${fileName}_video.m4v`;
    const audioFileName = `${directoryPath}/${fileName}_audio.mp4`;

    console.log("[INFO] Start Downloading...\n")
    await downloadFile(videoUrl, videoFileName);
    await downloadFile(audioUrl, audioFileName);

    console.log("[INFO] Merging Video with Audio...\n")
    const videoFileNameOutput = `${directoryPath}/${fileName}_final.mp4`;
    const ffmpegCommand = `ffmpeg -i ${videoFileName} -i ${audioFileName} -vcodec copy -acodec copy -f mp4 ${videoFileNameOutput}`;
    await executeCommandLine(ffmpegCommand);

    console.log(`[DONE] Files linked as: ${videoFileNameOutput} \n`);

    await deleteFile(videoFileName);
    await deleteFile(audioFileName);

    console.log(`[CLEANUP] Deleting old video & audio file`);
}

main();