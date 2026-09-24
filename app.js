(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    fileInput: $("#fileInput"),
    dropZone: $("#dropZone"),
    emptyState: $("#emptyState"),
    audioList: $("#audioList"),
    audioItemTemplate: $("#audioItemTemplate"),
    queueCount: $("#queueCount"),
    listActions: $("#listActions"),
    clearButton: $("#clearButton"),
    summaryFiles: $("#summaryFiles"),
    summaryDuration: $("#summaryDuration"),
    summarySize: $("#summarySize"),
    outputName: $("#outputName"),
    channelMode: $("#channelMode"),
    mergeButton: $("#mergeButton"),
    progressWrap: $("#progressWrap"),
    progressBar: $("#progressBar"),
    progressText: $("#progressText"),
    statusMessage: $("#statusMessage"),
    sourcePreview: $("#sourcePreview"),
    sourcePreviewName: $("#sourcePreviewName"),
    sourcePlayer: $("#sourcePlayer"),
    resultCard: $("#resultCard"),
    resultPlayer: $("#resultPlayer"),
    resultMeta: $("#resultMeta"),
    downloadButton: $("#downloadButton"),
    installButton: $("#installButton"),
  };

  const state = {
    tracks: [],
    busy: false,
    draggingId: null,
    resultUrl: null,
    deferredInstallPrompt: null,
  };

  function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function isSupportedAudio(file) {
    const name = file.name.toLowerCase();
    return name.endsWith(".mp3") || name.endsWith(".wav") || ["audio/mpeg", "audio/wav", "audio/x-wav"].includes(file.type);
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "读取中…";
    const whole = Math.round(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    return hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
  }

  function escapeFileName(value) {
    return (value.trim() || "合并音频").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
  }

  function readDuration(track) {
    return new Promise((resolve) => {
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.src = track.url;
      const done = (duration) => {
        audio.removeAttribute("src");
        audio.load();
        resolve(duration);
      };
      audio.addEventListener("loadedmetadata", () => done(Number.isFinite(audio.duration) ? audio.duration : 0), { once: true });
      audio.addEventListener("error", () => done(0), { once: true });
    });
  }

  async function addFiles(fileList) {
    if (state.busy) return;
    const files = [...fileList];
    const accepted = files.filter(isSupportedAudio);
    const rejected = files.length - accepted.length;

    if (rejected > 0) showMessage(`有 ${rejected} 个文件不是 MP3 或 WAV，已跳过。`);
    if (!accepted.length) return;

    const newTracks = accepted.map((file) => ({ id: makeId(), file, url: URL.createObjectURL(file), duration: NaN }));
    state.tracks.push(...newTracks);
    clearResult();
    render();
    elements.fileInput.value = "";

    await Promise.all(newTracks.map(async (track) => {
      track.duration = await readDuration(track);
    }));
    render();
  }

  function removeTrack(id) {
    if (state.busy) return;
    const index = state.tracks.findIndex((track) => track.id === id);
    if (index < 0) return;
    const [track] = state.tracks.splice(index, 1);
    URL.revokeObjectURL(track.url);
    if (elements.sourcePlayer.src === track.url) hideSourcePreview();
    clearResult();
    render();
  }

  function moveTrack(id, offset) {
    if (state.busy) return;
    const index = state.tracks.findIndex((track) => track.id === id);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= state.tracks.length) return;
    [state.tracks[index], state.tracks[nextIndex]] = [state.tracks[nextIndex], state.tracks[index]];
    clearResult();
    render();
  }

  function reorderTrack(sourceId, targetId) {
    if (!sourceId || sourceId === targetId || state.busy) return;
    const sourceIndex = state.tracks.findIndex((track) => track.id === sourceId);
    const targetIndex = state.tracks.findIndex((track) => track.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [track] = state.tracks.splice(sourceIndex, 1);
    state.tracks.splice(targetIndex, 0, track);
    clearResult();
    render();
  }

  function previewTrack(track) {
    elements.sourcePreviewName.textContent = track.file.name;
    elements.sourcePlayer.src = track.url;
    elements.sourcePreview.hidden = false;
    elements.sourcePlayer.play().catch(() => {});
  }

  function hideSourcePreview() {
    elements.sourcePlayer.pause();
    elements.sourcePlayer.removeAttribute("src");
    elements.sourcePlayer.load();
    elements.sourcePreview.hidden = true;
  }

  function render() {
    const count = state.tracks.length;
    const totalBytes = state.tracks.reduce((sum, track) => sum + track.file.size, 0);
    const totalDuration = state.tracks.reduce((sum, track) => sum + (Number.isFinite(track.duration) ? track.duration : 0), 0);

    elements.audioList.replaceChildren();
    state.tracks.forEach((track, index) => {
      const item = elements.audioItemTemplate.content.firstElementChild.cloneNode(true);
      item.dataset.id = track.id;
      item.draggable = !state.busy;
      item.querySelector(".track-number").textContent = String(index + 1).padStart(2, "0");
      item.querySelector(".track-name").textContent = track.file.name;
      item.querySelector(".track-meta").textContent = `${formatDuration(track.duration)} · ${formatBytes(track.file.size)}`;

      const up = item.querySelector(".move-up");
      const down = item.querySelector(".move-down");
      up.disabled = state.busy || index === 0;
      down.disabled = state.busy || index === count - 1;
      item.querySelectorAll("button").forEach((button) => { button.disabled = button.disabled || state.busy; });

      item.querySelector(".play-item").addEventListener("click", () => previewTrack(track));
      up.addEventListener("click", () => moveTrack(track.id, -1));
      down.addEventListener("click", () => moveTrack(track.id, 1));
      item.querySelector(".remove-item").addEventListener("click", () => removeTrack(track.id));

      item.addEventListener("dragstart", () => {
        state.draggingId = track.id;
        requestAnimationFrame(() => item.classList.add("dragging"));
      });
      item.addEventListener("dragend", () => {
        state.draggingId = null;
        item.classList.remove("dragging");
        document.querySelectorAll(".drag-over").forEach((node) => node.classList.remove("drag-over"));
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (state.draggingId !== track.id) item.classList.add("drag-over");
      });
      item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        item.classList.remove("drag-over");
        reorderTrack(state.draggingId, track.id);
      });
      elements.audioList.append(item);
    });

    elements.emptyState.hidden = count > 0;
    elements.listActions.hidden = count === 0;
    elements.queueCount.textContent = `${count} 个文件`;
    elements.summaryFiles.textContent = String(count);
    elements.summaryDuration.textContent = formatDuration(totalDuration);
    elements.summarySize.textContent = formatBytes(totalBytes);
    elements.mergeButton.disabled = state.busy || count < 2;
    elements.fileInput.disabled = state.busy;
    elements.channelMode.disabled = state.busy;
    elements.outputName.disabled = state.busy;
  }

  function showMessage(message) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.hidden = false;
  }

  function hideMessage() {
    elements.statusMessage.hidden = true;
    elements.statusMessage.textContent = "";
  }

  function setProgress(percent, text) {
    elements.progressWrap.hidden = false;
    elements.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    elements.progressText.textContent = text;
  }

  function clearResult() {
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = null;
    elements.resultPlayer.pause();
    elements.resultPlayer.removeAttribute("src");
    elements.resultPlayer.load();
    elements.downloadButton.removeAttribute("href");
    elements.resultCard.hidden = true;
  }

  function yieldToBrowser() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function writeAscii(view, offset, value) {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  }

  function writeWavHeader(view, frames, channels, sampleRate) {
    const dataSize = frames * channels * 2;
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);
  }

  function floatToPcm16(value) {
    const sample = Math.max(-1, Math.min(1, value));
    return sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  async function encodeWav(buffers, channels, sampleRate) {
    const totalFrames = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const dataBytes = totalFrames * channels * 2;
    if (dataBytes > 0x7ffff000) throw new Error("合并后的文件超过浏览器可处理范围，请分成两次合并。");

    const output = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(output);
    writeWavHeader(view, totalFrames, channels, sampleRate);
    let byteOffset = 44;
    let completedFrames = 0;

    for (let bufferIndex = 0; bufferIndex < buffers.length; bufferIndex += 1) {
      const buffer = buffers[bufferIndex];
      const left = buffer.getChannelData(0);
      const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

      for (let frame = 0; frame < buffer.length; frame += 1) {
        if (channels === 1) {
          view.setInt16(byteOffset, floatToPcm16((left[frame] + right[frame]) / 2), true);
          byteOffset += 2;
        } else {
          view.setInt16(byteOffset, floatToPcm16(left[frame]), true);
          view.setInt16(byteOffset + 2, floatToPcm16(right[frame]), true);
          byteOffset += 4;
        }

        if (frame > 0 && frame % 65536 === 0) {
          const percent = 58 + ((completedFrames + frame) / totalFrames) * 40;
          setProgress(percent, `正在生成文件 ${Math.round(percent)}%`);
          await yieldToBrowser();
        }
      }
      completedFrames += buffer.length;
    }
    return new Blob([output], { type: "audio/wav" });
  }

  async function mergeAudio() {
    if (state.busy || state.tracks.length < 2) return;
    hideMessage();
    clearResult();
    hideSourcePreview();
    state.busy = true;
    render();
    setProgress(2, "正在读取音频…");

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      showMessage("当前浏览器不支持音频处理，请换用较新的 Chrome、Edge 或系统浏览器。");
      state.busy = false;
      elements.progressWrap.hidden = true;
      render();
      return;
    }

    let audioContext;
    try {
      audioContext = new AudioContextClass();
      if (audioContext.state === "suspended") await audioContext.resume();
      const buffers = [];

      for (let index = 0; index < state.tracks.length; index += 1) {
        const track = state.tracks[index];
        setProgress(5 + (index / state.tracks.length) * 50, `正在解码 ${index + 1}/${state.tracks.length}：${track.file.name}`);
        const fileData = await track.file.arrayBuffer();
        try {
          buffers.push(await audioContext.decodeAudioData(fileData));
        } catch {
          throw new Error(`无法读取“${track.file.name}”，文件可能损坏或编码不受支持。`);
        }
        await yieldToBrowser();
      }

      const channelMode = elements.channelMode.value;
      const channels = channelMode === "mono" ? 1 : channelMode === "stereo" ? 2 : Math.min(2, Math.max(...buffers.map((buffer) => buffer.numberOfChannels)));
      const sampleRate = audioContext.sampleRate;
      const totalFrames = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
      const estimatedBytes = 44 + totalFrames * channels * 2;

      if (estimatedBytes > 280 * 1024 * 1024) {
        const shouldContinue = window.confirm(`预计会生成 ${formatBytes(estimatedBytes)} 的 WAV 文件，手机可能需要较长时间或内存不足。是否继续？`);
        if (!shouldContinue) throw new Error("已取消合并。可以减少音频数量后重试。");
      }

      setProgress(58, "正在生成 WAV 文件…");
      const blob = await encodeWav(buffers, channels, sampleRate);
      state.resultUrl = URL.createObjectURL(blob);
      const fileName = `${escapeFileName(elements.outputName.value)}.wav`;
      const duration = totalFrames / sampleRate;

      elements.resultPlayer.src = state.resultUrl;
      elements.downloadButton.href = state.resultUrl;
      elements.downloadButton.download = fileName;
      elements.resultMeta.textContent = `${formatDuration(duration)} · ${formatBytes(blob.size)}`;
      elements.resultCard.hidden = false;
      setProgress(100, "合并完成");
      setTimeout(() => { elements.progressWrap.hidden = true; }, 650);
      elements.resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "合并失败，请重新选择文件后再试。");
      elements.progressWrap.hidden = true;
    } finally {
      if (audioContext) await audioContext.close().catch(() => {});
      state.busy = false;
      render();
    }
  }

  elements.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
  elements.clearButton.addEventListener("click", () => {
    if (state.busy) return;
    state.tracks.forEach((track) => URL.revokeObjectURL(track.url));
    state.tracks = [];
    hideSourcePreview();
    clearResult();
    hideMessage();
    render();
  });
  elements.mergeButton.addEventListener("click", mergeAudio);
  elements.outputName.addEventListener("input", clearResult);
  elements.channelMode.addEventListener("change", clearResult);

  ["dragenter", "dragover"].forEach((type) => elements.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    if (!state.busy) elements.dropZone.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((type) => elements.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  }));
  elements.dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });
  elements.installButton.addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });
  window.addEventListener("appinstalled", () => { elements.installButton.hidden = true; });

  window.addEventListener("beforeunload", () => {
    state.tracks.forEach((track) => URL.revokeObjectURL(track.url));
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const allowedChannels = new Set(["auto", "mono", "stereo"]);

    Promise.resolve(context.registerTool({
      name: "get_audio_merge_state",
      title: "读取音频合并状态",
      description: "读取当前已选音频数量、顺序、总时长和输出设置，不修改页面。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute() {
        return {
          trackCount: state.tracks.length,
          tracks: state.tracks.map((track, index) => ({
            order: index + 1,
            name: track.file.name,
            durationSeconds: Number.isFinite(track.duration) ? Math.round(track.duration * 10) / 10 : null,
            sizeBytes: track.file.size,
          })),
          outputName: escapeFileName(elements.outputName.value),
          channelMode: elements.channelMode.value,
          readyToMerge: state.tracks.length >= 2 && !state.busy,
        };
      },
    })).catch(() => {});

    Promise.resolve(context.registerTool({
      name: "configure_audio_merge_output",
      title: "设置合并输出",
      description: "设置合并后 WAV 文件的名称和声道模式，并同步更新页面。",
      inputSchema: {
        type: "object",
        properties: {
          outputName: { type: "string", minLength: 1, maxLength: 80, description: "不带 .wav 后缀的文件名" },
          channelMode: { type: "string", enum: ["auto", "mono", "stereo"] },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== "object") throw new Error("需要提供输出设置。");
        if (input.outputName !== undefined) {
          if (typeof input.outputName !== "string" || !input.outputName.trim() || input.outputName.length > 80) {
            throw new Error("输出文件名必须是 1 到 80 个字符。");
          }
          elements.outputName.value = input.outputName;
        }
        if (input.channelMode !== undefined) {
          if (!allowedChannels.has(input.channelMode)) throw new Error("声道模式必须是 auto、mono 或 stereo。");
          elements.channelMode.value = input.channelMode;
        }
        clearResult();
        return {
          outputName: escapeFileName(elements.outputName.value),
          channelMode: elements.channelMode.value,
        };
      },
    })).catch(() => {});
  }

  render();
  registerWebMcpTools();
})();
