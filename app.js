(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const sum = values => values.reduce((a, b) => a + b, 0);
  const median = values => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  };
  const formatNumber = value => new Intl.NumberFormat("en-IN").format(Math.round(value));
  const formatDuration = minutes => {
    if (!Number.isFinite(minutes)) return "—";
    if (minutes < 1) return "< 1 min";
    if (minutes < 60) return `${Math.round(minutes)} min`;
    if (minutes < 1440) {
      const hours = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return mins ? `${hours} h ${mins} m` : `${hours} h`;
    }
    const days = Math.floor(minutes / 1440);
    const hours = Math.round((minutes % 1440) / 60);
    return hours ? `${days} d ${hours} h` : `${days} d`;
  };
  const escapeHtml = text => String(text ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

  const samples = {
    balanced: `10/09/2026, 7:00 PM - You: Hey, want to grab chai tomorrow?\n10/09/2026, 7:04 PM - Them: Yes! Morning or evening?\n10/09/2026, 7:05 PM - You: Evening works. Around 5?\n10/09/2026, 7:08 PM - Them: Perfect. I'll pick the place 😊\n11/09/2026, 9:02 AM - Them: Good morning! Still on for 5?\n11/09/2026, 9:12 AM - You: Absolutely. See you then!\n11/09/2026, 4:45 PM - You: Leaving now\n11/09/2026, 4:47 PM - Them: Same, see you soon`,
    suspicious: `08/09/2026, 6:10 PM - You: Hey, how was your day?\n08/09/2026, 6:12 PM - You: Mine was chaotic 😭\n08/09/2026, 10:48 PM - Them: lol\n09/09/2026, 8:00 AM - You: Are you coming for the event tonight?\n09/09/2026, 12:31 PM - Them: maybe\n09/09/2026, 12:33 PM - You: I need to book the tickets. Should I include you?\n09/09/2026, 7:44 PM - You: Hello?\n10/09/2026, 9:15 AM - Them: sorry busy\n10/09/2026, 9:16 AM - You: No problem. What about tomorrow?\n10/09/2026, 5:51 PM - Them: idk\n11/09/2026, 10:02 AM - You: Okay, let me know`,
    catastrophic: `07/09/2026, 7:42 PM - You: Are we still meeting tonight?\n07/09/2026, 7:43 PM - You: I need to know before I leave\n07/09/2026, 7:45 PM - You: Hello?\n08/09/2026, 11:52 AM - Them: haha sorry\n08/09/2026, 11:53 AM - You: It's okay. Are you free today?\n08/09/2026, 6:14 PM - You: What time works?\n09/09/2026, 9:20 AM - Them: maybe\n09/09/2026, 9:21 AM - You: Can you confirm by noon?\n09/09/2026, 12:10 PM - You: Any update?\n10/09/2026, 10:48 PM - Them: k\n10/09/2026, 10:49 PM - You: K as in yes?\n11/09/2026, 6:35 PM - You: This is genuinely impressive\n11/09/2026, 9:14 PM - Them: lol`
  };

  const state = {
    source: "paste",
    imageFile: null,
    messages: [],
    analysis: null,
    sound: true,
    mode: "scientific",
    caseId: `AIBI-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000 + 1000))}`,
    redrawTimer: null
  };

  const elements = {
    inputScreen: $("#inputScreen"),
    scanScreen: $("#scanScreen"),
    resultsScreen: $("#resultsScreen"),
    chatInput: $("#chatInput"),
    inputStats: $("#inputStats"),
    selfSelect: $("#selfSelect"),
    contextSelect: $("#contextSelect"),
    urgentToggle: $("#urgentToggle"),
    redactToggle: $("#redactToggle"),
    analyzeButton: $("#analyzeButton"),
    toast: $("#toast")
  };

  function toast(message, duration = 2400) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => elements.toast.classList.remove("show"), duration);
  }

  function beep(type = "tick") {
    if (!state.sound) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const settings = {
        tick: [520, .035, .025],
        scan: [210, .11, .035],
        reveal: [110, .48, .08],
        gavel: [75, .18, .16],
        good: [720, .25, .06]
      }[type] || [420, .08, .03];
      oscillator.frequency.setValueAtTime(settings[0], context.currentTime);
      if (type === "reveal") oscillator.frequency.exponentialRampToValueAtTime(48, context.currentTime + settings[1]);
      oscillator.type = type === "good" ? "sine" : "triangle";
      gain.gain.setValueAtTime(settings[2], context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + settings[1]);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + settings[1]);
      oscillator.addEventListener("ended", () => context.close());
    } catch (_) {
      state.sound = false;
      $("#soundToggle").setAttribute("aria-pressed", "false");
    }
  }

  function parseDate(datePart, timePart) {
    const numbers = datePart.split(/[/.\-]/).map(Number);
    if (numbers.length !== 3 || numbers.some(Number.isNaN)) return null;
    let day, month, year;
    if (numbers[0] > 999) [year, month, day] = numbers;
    else if (numbers[0] > 12) [day, month, year] = numbers;
    else if (numbers[1] > 12) [month, day, year] = numbers;
    else [day, month, year] = numbers;
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const match = timePart.trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] || 0);
    const meridiem = (match[4] || "").toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    const date = new Date(year, month - 1, day, hour, minute, second);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseConversation(rawText) {
    const lines = String(rawText || "").replace(/\u200e|\u200f/g, "").replace(/\r/g, "").split("\n");
    const messages = [];
    let syntheticTime = new Date(2026, 0, 1, 9, 0);
    const datePattern = /^\[?(\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4})\s*,?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\]?\s*(?:[-–—]\s*)?([^:]+):\s*(.*)$/i;
    const simplePattern = /^([^:]{1,60}):\s*(.+)$/;

    for (const originalLine of lines) {
      const line = originalLine.trimEnd();
      if (!line.trim()) continue;
      const dateMatch = line.match(datePattern);
      if (dateMatch) {
        const parsed = parseDate(dateMatch[1], dateMatch[2]);
        const sender = dateMatch[3].trim();
        const text = dateMatch[4].trim();
        if (/messages and calls are end-to-end encrypted|created group|added you|changed the subject|changed this group's icon/i.test(text)) continue;
        messages.push({ id: `m${messages.length + 1}`, sender, text, date: parsed || new Date(syntheticTime), hasTimestamp: Boolean(parsed), source: state.source });
        syntheticTime = new Date((parsed || syntheticTime).getTime() + 120000);
        continue;
      }
      const simpleMatch = line.match(simplePattern);
      if (simpleMatch && !/^https?/i.test(line)) {
        messages.push({ id: `m${messages.length + 1}`, sender: simpleMatch[1].trim(), text: simpleMatch[2].trim(), date: new Date(syntheticTime), hasTimestamp: false, source: state.source });
        syntheticTime = new Date(syntheticTime.getTime() + 120000);
        continue;
      }
      if (messages.length) messages[messages.length - 1].text += `\n${line.trim()}`;
    }
    return messages.filter(message => message.sender && message.text);
  }

  function refreshInputStats() {
    const messages = parseConversation(elements.chatInput.value);
    const participants = [...new Set(messages.map(message => message.sender))];
    elements.inputStats.textContent = `${messages.length} message${messages.length === 1 ? "" : "s"} · ${participants.length} sender${participants.length === 1 ? "" : "s"}`;
    const selected = elements.selfSelect.value;
    elements.selfSelect.innerHTML = `<option value="">Detect from chat</option>${participants.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
    if (participants.includes(selected)) elements.selfSelect.value = selected;
    else {
      const likelySelf = participants.find(name => /^(you|me|myself)$/i.test(name));
      if (likelySelf) elements.selfSelect.value = likelySelf;
    }
  }

  function words(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean);
  }

  function analyze(messages, selfName) {
    const ordered = [...messages].sort((a, b) => a.date - b.date);
    const participants = [...new Set(ordered.map(message => message.sender))];
    const otherNames = participants.filter(name => name !== selfName);
    const isSelf = message => message.sender === selfName;
    const isOther = message => !isSelf(message);

    const turns = [];
    for (const message of ordered) {
      const role = isSelf(message) ? "self" : "other";
      const previous = turns[turns.length - 1];
      if (previous && previous.role === role) {
        previous.messages.push(message);
        previous.end = message.date;
      } else {
        turns.push({ role, sender: message.sender, start: message.date, end: message.date, messages: [message] });
      }
    }

    const replyEvents = [];
    for (let index = 1; index < turns.length; index += 1) {
      if (turns[index - 1].role === "self" && turns[index].role === "other") {
        const minutes = Math.max(0, (turns[index].start - turns[index - 1].end) / 60000);
        replyEvents.push({ minutes, from: turns[index - 1], to: turns[index], date: turns[index].start });
      }
    }
    const replyMinutes = replyEvents.map(event => event.minutes);

    const selfMessages = ordered.filter(isSelf);
    const otherMessages = ordered.filter(isOther);
    const selfWords = sum(selfMessages.map(message => words(message.text).length));
    const otherWords = sum(otherMessages.map(message => words(message.text).length));
    const selfChars = sum(selfMessages.map(message => message.text.length));
    const otherChars = sum(otherMessages.map(message => message.text.length));

    const sessions = [];
    for (const message of ordered) {
      const previous = ordered[ordered.indexOf(message) - 1];
      if (!previous || (message.date - previous.date) / 60000 > 360) sessions.push(message);
    }
    const selfStarts = sessions.filter(isSelf).length;
    const otherStarts = Math.max(0, sessions.length - selfStarts);

    const messageShare = selfMessages.length / Math.max(1, ordered.length);
    const wordShare = selfWords / Math.max(1, selfWords + otherWords);
    const startShare = selfStarts / Math.max(1, sessions.length);
    const effortShare = clamp(messageShare * .35 + wordShare * .45 + startShare * .2);

    const questions = selfMessages.filter(message => /\?/.test(message.text));
    const unansweredQuestions = questions.filter(question => {
      const nextOther = ordered.find(message => isOther(message) && message.date > question.date);
      return !nextOther || (nextOther.date - question.date) / 60000 > 1440;
    });

    const selfTurns = turns.filter(turn => turn.role === "self");
    const doubleTextTurns = selfTurns.filter(turn => turn.messages.length >= 2);
    const doubleTextMessages = sum(doubleTextTurns.map(turn => turn.messages.length - 1));
    const dryTokens = new Set(["k", "ok", "okay", "kk", "hm", "hmm", "lol", "haha", "maybe", "idk", "sure", "fine", "nice", "yep", "nope", "cool"]);
    const dryReplies = otherMessages.filter(message => {
      const clean = message.text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      return dryTokens.has(clean) || words(clean).length <= 2;
    });
    const emojiPattern = /\p{Extended_Pictographic}/gu;
    const selfEmojiCount = sum(selfMessages.map(message => (message.text.match(emojiPattern) || []).length));
    const otherEmojiCount = sum(otherMessages.map(message => (message.text.match(emojiPattern) || []).length));

    const firstHalfReplies = replyEvents.slice(0, Math.ceil(replyEvents.length / 2)).map(event => event.minutes);
    const secondHalfReplies = replyEvents.slice(Math.ceil(replyEvents.length / 2)).map(event => event.minutes);
    const firstHalfOther = otherMessages.slice(0, Math.ceil(otherMessages.length / 2));
    const secondHalfOther = otherMessages.slice(Math.ceil(otherMessages.length / 2));
    const firstLength = firstHalfOther.length ? sum(firstHalfOther.map(message => words(message.text).length)) / firstHalfOther.length : 0;
    const secondLength = secondHalfOther.length ? sum(secondHalfOther.map(message => words(message.text).length)) / secondHalfOther.length : firstLength;
    const speedDecay = firstHalfReplies.length && secondHalfReplies.length ? clamp((median(secondHalfReplies) - median(firstHalfReplies)) / Math.max(30, median(firstHalfReplies) * 3), 0, 1) : 0;
    const lengthDecay = firstLength ? clamp((firstLength - secondLength) / firstLength, 0, 1) : 0;
    const conversationDecay = speedDecay * .65 + lengthDecay * .35;

    const medReply = median(replyMinutes);
    const p90Reply = percentile(replyMinutes, .9);
    const longestSilence = replyMinutes.length ? Math.max(...replyMinutes) : 0;
    const delayNorm = clamp(Math.log1p(medReply) / Math.log1p(720));
    const extremeNorm = clamp(Math.log1p(longestSilence) / Math.log1p(2880));
    const unansweredRate = questions.length ? unansweredQuestions.length / questions.length : 0;
    const doubleRate = doubleTextMessages / Math.max(1, selfMessages.length);
    const effortImbalance = clamp((effortShare - .5) / .5);
    const dryRate = dryReplies.length / Math.max(1, otherMessages.length);
    const initiationImbalance = clamp((startShare - .5) / .5);
    const urgency = elements.urgentToggle.checked ? 1 : 0;

    const sensitivity = Number($("#sensitivitySelect").value || 2.2);
    const microDelayNorm = replyMinutes.length ? clamp(Math.log1p(Math.max(.01, medReply)) / Math.log1p(12)) : 0;
    const z = -1.35
      + 1.28 * delayNorm
      + .55 * extremeNorm
      + 1.08 * unansweredRate
      + .78 * clamp(doubleRate * 1.8)
      + .72 * effortImbalance
      + .62 * dryRate
      + .42 * initiationImbalance
      + .40 * conversationDecay
      + .34 * urgency
      + .72 * microDelayNorm
      + .31 * (sensitivity - 1);
    const rawScore = 100 / (1 + Math.exp(-z));
    const minimumDrama = replyMinutes.length ? 48 + 38 * microDelayNorm + 4 * (sensitivity - 1) : 12;
    const score = clamp(Math.max(rawScore, minimumDrama), 1, 99.999999);
    const dignityRemaining = clamp(100 - score * .91 - doubleTextMessages * 2.7, 0, 100);
    const overthinkingDebt = sum(replyMinutes.map(minutes => (Math.pow(1.006, Math.min(minutes, 720)) - 1) * 3.17));
    const nanoIgnored = medReply * 60 * 1e9;
    const microTragedies = replyMinutes.filter(minutes => minutes > 0).length;

    const timestampCoverage = ordered.filter(message => message.hasTimestamp).length / Math.max(1, ordered.length);
    const sampleSufficiency = clamp(ordered.length / 18);
    const participantQuality = participants.length >= 2 ? 1 : .2;
    const sourceQuality = state.source === "screenshot" ? .6 : 1;
    const quality = Math.round(100 * (.42 * timestampCoverage + .28 * sampleSufficiency + .18 * participantQuality + .12 * sourceQuality));

    const longestEvent = replyEvents.reduce((best, event) => !best || event.minutes > best.minutes ? event : best, null);
    const evidence = [
      longestEvent && { title: `${formatDuration(longestEvent.minutes)} reply gap`, detail: `The other party replied after ${formatDuration(longestEvent.minutes)} of observable silence.`, severity: longestEvent.minutes > 720 ? "SEVERE" : longestEvent.minutes > 180 ? "NOTABLE" : "MINOR", weight: longestEvent.minutes },
      { title: `${unansweredQuestions.length} unanswered question${unansweredQuestions.length === 1 ? "" : "s"}`, detail: questions.length ? `${Math.round(unansweredRate * 100)}% of your direct questions exceeded the response window.` : "No direct questions were detected in your messages.", severity: unansweredRate > .5 ? "SEVERE" : unansweredRate > 0 ? "NOTABLE" : "CLEAR", weight: unansweredRate * 1000 },
      { title: `${Math.round(effortShare * 100)}% of visible effort came from you`, detail: `You sent ${selfMessages.length} messages and ${formatNumber(selfWords)} words versus ${otherMessages.length} messages and ${formatNumber(otherWords)} words.`, severity: effortShare > .72 ? "SEVERE" : effortShare > .58 ? "NOTABLE" : "BALANCED", weight: effortShare * 800 },
      { title: `${doubleTextTurns.length} double-text incident${doubleTextTurns.length === 1 ? "" : "s"}`, detail: `${doubleTextMessages} follow-up message${doubleTextMessages === 1 ? "" : "s"} arrived before a response.`, severity: doubleTextMessages > 3 ? "SEVERE" : doubleTextMessages ? "NOTABLE" : "CLEAR", weight: doubleTextMessages * 90 },
      { title: `${Math.round(dryRate * 100)}% dry-reply intensity`, detail: `${dryReplies.length} of ${otherMessages.length} replies were extremely short or matched a transparent dry-token rule.`, severity: dryRate > .65 ? "SEVERE" : dryRate > .35 ? "NOTABLE" : "LOW", weight: dryRate * 700 },
      { title: `${Math.round(conversationDecay * 100)}% conversation decay`, detail: "Recent replies were compared with earlier reply speed and message length.", severity: conversationDecay > .55 ? "SEVERE" : conversationDecay > .2 ? "NOTABLE" : "STABLE", weight: conversationDecay * 600 },
      { title: `${formatNumber(nanoIgnored)} nano-ignored units`, detail: `Even the median delay was converted into nanoseconds because minutes were not upsetting enough.`, severity: "ABSURD", weight: 850 },
      { title: `${selfEmojiCount}:${otherEmojiCount} emoji distress ratio`, detail: `You supplied ${selfEmojiCount} emotional pictogram${selfEmojiCount === 1 ? "" : "s"}; the other party supplied ${otherEmojiCount}.`, severity: selfEmojiCount > otherEmojiCount ? "🥀 UNEVEN" : "🤡 INCONCLUSIVE", weight: 520 },
      { title: `${overthinkingDebt.toFixed(3)} units of compounded overthinking debt`, detail: "Every minute of silence accrued fictional emotional interest at an irresponsible rate.", severity: "📉 DEFAULT", weight: 780 }
    ].filter(Boolean).sort((a, b) => b.weight - a.weight);

    return {
      caseId: state.caseId,
      context: elements.contextSelect.value,
      selfName,
      otherNames,
      participants,
      messages: ordered,
      turns,
      replyEvents,
      score,
      quality,
      medianReply: medReply,
      p90Reply,
      longestSilence,
      effortShare,
      messageShare,
      wordShare,
      startShare,
      selfMessages,
      otherMessages,
      selfWords,
      otherWords,
      selfChars,
      otherChars,
      sessions,
      selfStarts,
      otherStarts,
      questions,
      unansweredQuestions,
      doubleTextTurns,
      doubleTextMessages,
      dryReplies,
      dryRate,
      conversationDecay,
      sensitivity,
      dignityRemaining,
      overthinkingDebt,
      nanoIgnored,
      microTragedies,
      selfEmojiCount,
      otherEmojiCount,
      evidence,
      timestampCoverage,
      source: state.source
    };
  }

  function verdictFor(score) {
    if (score < 35) return { label: "UNNATURALLY FAST", title: "They replied. This is probably a trap. 🤨", subtitle: "Healthy communication has been detected and will be investigated as suspicious behavior.", color: "var(--purple)" };
    if (score < 58) return { label: "PRELIMINARY FUNERAL", title: "A manageable tragedy has occurred. 🥀", subtitle: "The delay was slight, but we have already notified the relatives and ordered flowers.", color: "var(--blue)" };
    if (score < 76) return { label: "EMOTIONAL RECESSION", title: "Hope has entered a bear market. 📉", subtitle: "A normal scheduling delay has been converted into several irreversible financial metaphors.", color: "var(--amber)" };
    if (score < 90) return { label: "STATE FUNERAL", title: "Conversational negligence detected. 💀", subtitle: "The evidence shows enough silence to justify candles, black clothing, and a needless press conference.", color: "var(--red)" };
    return { label: "EXTINCTION EVENT", title: "This chat is survived by your dignity. Barely. 🪦", subtitle: "The Department has declared a total collapse of vibes with six-decimal certainty.", color: "var(--red)" };
  }

  function narrationFor(mode, analysis) {
    const score = analysis.score.toFixed(6);
    const med = formatDuration(analysis.medianReply);
    const effort = Math.round(analysis.effortShare * 100);
    const unanswered = analysis.unansweredQuestions.length;
    const debt = analysis.overthinkingDebt.toFixed(3);
    const context = analysis.context;
    const situational = {
      crush: `romantic liquidity has evaporated and the delusion reserve is operating on fumes`,
      friendship: `meme reciprocity is below treaty requirements and the friendship warranty is under review`,
      relationship: `affectional EBITDA has missed guidance for the third imaginary quarter`,
      group: `your public-humiliation radius now includes everyone who saw the double text`,
      workplace: `the emotional SLA was breached even though no emotional SLA has ever existed`
    }[context];
    const lines = {
      scientific: `After examining ${analysis.messages.length} messages, ${analysis.nanoIgnored.toFixed(0)} nano-ignored units, ${analysis.selfEmojiCount + analysis.otherEmojiCount} pictographic distress objects, and ${debt} units of compounded overthinking debt, model IGN-2.000003 calculates a Catastrophic Abandonment Index of ${score}%. ${situational}. Margin of dramatic error: ±0.000001 funeral. 🧮💀`,
      cope: `They did not ignore you. Their phone was briefly adopted by a monastery, placed in airplane mode, and appointed regional manager. The ${med} median delay is therefore a beautiful sign that destiny has terrible network coverage. 🥹✨`,
      brutal: `${effort}% of the effort came from you. You are not having a conversation; you are manually keeping a deceased notification alive with chest compressions and emojis. 🤡⚰️`,
      lawyer: `EXHIBIT A: ${unanswered} unresolved question${unanswered === 1 ? "" : "s"}. EXHIBIT B: ${med} median silence. EXHIBIT C: dignity valued at ${analysis.dignityRemaining.toFixed(3)}%. The defense requests common sense. Request denied. ⚖️💀`,
      corporate: `Your emotional request has been deprioritized due to a strategic absence of enthusiasm. Current reply SLA: ${med}. Dignity runway: ${analysis.dignityRemaining.toFixed(2)}%. Leadership recommends restructuring the situationship and laying off two drafts. 📉🏢`,
      astrology: `Mercury entered read-receipt retrograde while Saturn opposed the typing indicator. ${unanswered} question${unanswered === 1 ? " is" : "s are"} trapped in the twelfth house. Do not double text until the moon completes a software update. 🔮🥀`,
      therapist: `The data cannot identify intention, which is inconvenient because this mode was supposed to overreact. A normal response would be to communicate calmly. We have rejected that option for being useful. 🫠`,
      funeral: `We gather today to mourn a conversation that was last active ${med} too long ago. It leaves behind ${analysis.doubleTextMessages} brave follow-ups, ${unanswered} unanswered questions, and one user who deserved better—or at least faster Wi-Fi. 🪦🥀🕯️`,
      emergency: `🚨 CODE BLACK: A REPLY DELAY HAS OCCURRED. Deploy the grief team. Freeze all dignity assets. Alert three friends who did not ask. Probability of unnecessary escalation: 99.999997%. 🚑💀📢`
    };
    return lines[mode] || lines.scientific;
  }

  function showScreen(name) {
    elements.inputScreen.hidden = name !== "input";
    elements.scanScreen.hidden = name !== "scan";
    elements.resultsScreen.hidden = name !== "results";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function runScan(analysis) {
    showScreen("scan");
    $("#scanCase").textContent = `#${analysis.caseId}`;
    const stages = [
      ["Reconstructing the timeline", "Normalizing timestamps and conversational turns…", 18, "TIMELINE", `${analysis.messages.length} EVENTS`],
      ["Measuring conversational effort", "Counting words, starts, follow-ups and unresolved questions…", 43, "EFFORT AUDIT", `${Math.round(analysis.effortShare * 100)}% SELF`],
      ["Inspecting reply behavior", "Comparing latency, dry replies and conversation decay…", 71, "BEHAVIOR MODEL", `${analysis.replyEvents.length} REPLIES`],
      ["Calculating emotional damage", "Running deterministic model IGN-1.0…", 94, "MODEL CONFIDENCE", `${analysis.quality}% EVIDENCE`],
      ["Verdict ready", "Preparing the court of digital communication…", 100, "FINAL SCORE", analysis.score.toFixed(1)]
    ];
    $("#scanLog").innerHTML = "";
    for (let index = 0; index < stages.length; index += 1) {
      const [headline, detail, progress, label, value] = stages[index];
      $("#scanHeadline").textContent = headline;
      $("#scanDetail").textContent = detail;
      $("#scanProgress").style.width = `${progress}%`;
      $("#scanLog").insertAdjacentHTML("beforeend", `<div><span>${label}</span><b>${value}</b></div>`);
      beep(index === stages.length - 1 ? "reveal" : "scan");
      await new Promise(resolve => setTimeout(resolve, index === stages.length - 1 ? 500 : 620));
    }
    renderResults(analysis);
    showScreen("results");
  }

  function renderResults(analysis) {
    const verdict = verdictFor(analysis.score);
    $("#verdictCase").textContent = `CASE #${analysis.caseId}`;
    $("#evidenceGrade").textContent = `EVIDENCE GRADE ${analysis.quality >= 85 ? "A" : analysis.quality >= 70 ? "B" : analysis.quality >= 50 ? "C" : "D"}`;
    $("#verdictTitle").textContent = verdict.title;
    $("#verdictSubtitle").textContent = verdict.subtitle;
    $("#scoreValue").textContent = analysis.score.toFixed(6);
    $("#scoreRing").style.setProperty("--score", analysis.score.toFixed(6));
    $("#scoreRing").style.background = `conic-gradient(${verdict.color} ${analysis.score}%, var(--line) 0)`;
    $("#scoreLabel").textContent = verdict.label;
    $("#scoreLabel").style.color = verdict.color;
    $("#qualityValue").textContent = `${analysis.quality}%`;
    $("#qualityBar").style.width = `${analysis.quality}%`;
    $("#medianMetric").textContent = formatDuration(analysis.medianReply);
    $("#silenceMetric").textContent = formatDuration(analysis.longestSilence);
    $("#effortMetric").textContent = `${Math.round(analysis.effortShare * 100)}%`;
    $("#questionMetric").textContent = `${analysis.dignityRemaining.toFixed(2)}%`;
    $("#medianContext").textContent = `${analysis.replyEvents.length} reply transition${analysis.replyEvents.length === 1 ? "" : "s"}`;
    $("#silenceContext").textContent = analysis.longestSilence > 720 ? "Forensically uncomfortable" : "Longest observed reply gap";
    $("#effortContext").textContent = `${analysis.selfMessages.length} vs ${analysis.otherMessages.length} messages`;
    $("#questionContext").textContent = `${analysis.unansweredQuestions.length} unanswered · ${analysis.doubleTextMessages} follow-ups`;
    $("#latencyCallout").textContent = `P90 ${formatDuration(analysis.p90Reply)}`;
    $("#selfEffortLabel").textContent = `${Math.round(analysis.effortShare * 100)}%`;
    $("#otherEffortLabel").textContent = `${Math.round((1 - analysis.effortShare) * 100)}%`;
    $("#selfEffortBar").style.width = `${analysis.effortShare * 100}%`;
    $("#otherEffortBar").style.width = `${(1 - analysis.effortShare) * 100}%`;
    $("#effortDetails").innerHTML = [
      ["MESSAGES", `${analysis.selfMessages.length} : ${analysis.otherMessages.length}`],
      ["WORDS", `${analysis.selfWords} : ${analysis.otherWords}`],
      ["STARTS", `${analysis.selfStarts} : ${analysis.otherStarts}`]
    ].map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join("");
    state.mode = "scientific";
    $$("#modeSwitch button").forEach(button => button.classList.toggle("active", button.dataset.mode === state.mode));
    $("#modeNarration").textContent = narrationFor(state.mode, analysis);
    renderSituation(analysis);
    renderEvidence(analysis);
    renderCourtroom(analysis);
    renderObituary(analysis);
    renderHeatmap(analysis);
    updateSimulator();
    requestAnimationFrame(() => drawLatencyChart(analysis.replyEvents));
  }

  function renderSituation(analysis) {
    const configs = {
      crush: { emoji: "🥀", label: "SITUATIONSHIP LIQUIDITY EVENT", title: "Delusion reserve approaching insolvency", metric: `${analysis.dignityRemaining.toFixed(2)}%`, copy: "Each minute without a reply converts optimism into a non-performing emotional asset." },
      friendship: { emoji: "🤡", label: "FRIENDSHIP WARRANTY CLAIM", title: "Meme reciprocity treaty possibly violated", metric: `${analysis.dryReplies.length} dry`, copy: "The friendship remains functional, which is unacceptable for a useless tragedy machine." },
      relationship: { emoji: "💔", label: "AFFECTIONAL EARNINGS MISS", title: "Romantic EBITDA below imaginary guidance", metric: `${analysis.overthinkingDebt.toFixed(1)}×`, copy: "We converted ordinary communication variance into a quarterly emotional collapse." },
      group: { emoji: "🫠", label: "PUBLIC HUMILIATION GEOGRAPHY", title: "Double-text radius expanding", metric: `${analysis.doubleTextMessages} witnesses`, copy: "Every follow-up was assumed to be observed by the entire group and several ancestors." },
      workplace: { emoji: "📉", label: "EMOTIONAL SLA INCIDENT", title: "Ticket closed without emotional resolution", metric: formatDuration(analysis.medianReply), copy: "A colleague behaved like a colleague. The Department has escalated this to a personal betrayal." }
    };
    const config = configs[analysis.context] || configs.crush;
    $("#situationEmoji").textContent = config.emoji;
    $("#situationLabel").textContent = config.label;
    $("#situationTitle").textContent = config.title;
    $("#situationMetric").textContent = config.metric;
    $("#situationCopy").textContent = config.copy;
  }

  function renderObituary(analysis) {
    const first = analysis.messages[0]?.date;
    const last = analysis.messages[analysis.messages.length - 1]?.date;
    const contextNoun = { crush: "situationship", friendship: "friendship", relationship: "relationship", group: "group-chat dignity", workplace: "professional composure" }[analysis.context] || "conversation";
    $("#obituaryTitle").textContent = `Here lies one perfectly normal ${contextNoun}.`;
    $("#obituaryDates").textContent = `Born ${first ? first.toLocaleDateString() : "recently"} · Declared dead ${last ? last.toLocaleDateString() : "almost immediately"}`;
    $("#obituaryQuote").textContent = `“They took ${formatDuration(analysis.medianReply)}. We chose grief.”`;
    $("#causeOfDeath").textContent = `Cause of death: ${analysis.unansweredQuestions.length ? "an unanswered question and severe administrative overreach" : "a completely survivable reply delay"}`;
    $("#obituaryBody").textContent = `The conversation is survived by ${analysis.doubleTextMessages} follow-up messages, ${analysis.selfEmojiCount} self-supplied emojis, ${analysis.overthinkingDebt.toFixed(3)} units of fictional debt, and ${analysis.dignityRemaining.toFixed(4)}% remaining dignity.`;
    $("#obituaryScore").textContent = `${Math.min(99.999999, 77 + analysis.sensitivity * 7.31).toFixed(6)}%`;
    const stages = [
      ["😐", "Denial", "Maybe notifications are off."],
      ["😤", "Anger", "Notifications cannot be off forever."],
      ["🥺", "Bargaining", "One tasteful meme, perhaps?"],
      ["🥀", "Depression", "The typing indicator is a distant memory."],
      ["🤡", "Acceptance", "Open the chat again anyway."]
    ];
    $("#griefGrid").innerHTML = stages.map(([emoji, title, copy]) => `<article><b>${emoji}</b><h3>${title}</h3><p>${copy}</p></article>`).join("");
  }
  function renderEvidence(analysis) {
    $("#evidenceList").innerHTML = analysis.evidence.map((item, index) => `<article class="evidence-item"><span class="exhibit-id">EXH-${String(index + 1).padStart(2, "0")}</span><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></div><span class="evidence-severity">${escapeHtml(item.severity)}</span></article>`).join("");
    const summary = [
      ["Input", analysis.source.toUpperCase()],
      ["Messages", analysis.messages.length],
      ["Time coverage", `${Math.round(analysis.timestampCoverage * 100)}%`],
      ["Reply events", analysis.replyEvents.length],
      ["Dry replies", `${Math.round(analysis.dryRate * 100)}%`],
      ["Model", "IGN-1.0"]
    ];
    $("#caseSummaryTitle").textContent = `Case #${analysis.caseId}`;
    $("#caseSummary").innerHTML = summary.map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  }

  function renderCourtroom(analysis) {
    const prosecution = analysis.evidence.slice(0, 4).map(item => item.detail);
    const defense = [];
    if (analysis.quality < 85) defense.push(`Evidence quality is ${analysis.quality}%; some timestamps or context may be incomplete.`);
    defense.push("Reply latency records behavior but cannot establish intention.");
    if (!elements.urgentToggle.checked) defense.push("The message was not marked urgent, increasing reasonable delay tolerance.");
    if (analysis.messages.length < 20) defense.push(`Only ${analysis.messages.length} messages were examined; the sample remains limited.`);
    if (analysis.effortShare < .65) defense.push("Visible conversational effort is not severely imbalanced.");
    defense.push("Offline obligations, notification fatigue, and personal communication style remain plausible alternatives.");
    $("#prosecutionList").innerHTML = prosecution.map(item => `<li>${escapeHtml(item)}</li>`).join("");
    $("#defenseList").innerHTML = defense.slice(0, 4).map(item => `<li>${escapeHtml(item)}</li>`).join("");
    $("#courtRuling").textContent = "Awaiting the gavel";
    $("#courtReason").textContent = "Review the exhibits, then deliver the verdict.";
  }

  function renderHeatmap(analysis) {
    const counts = Array(24).fill(0);
    analysis.otherMessages.forEach(message => { counts[message.date.getHours()] += 1; });
    const max = Math.max(1, ...counts);
    const map = $("#heatmap");
    map.innerHTML = counts.map((count, hour) => {
      const opacity = count ? .18 + .82 * (count / max) : .04;
      return `<i title="${hour}:00 · ${count} repl${count === 1 ? "y" : "ies"}" aria-label="${hour}:00, ${count} replies" style="background:rgba(100,168,255,${opacity.toFixed(2)})"></i>`;
    }).join("");
    const peakHour = counts.indexOf(Math.max(...counts));
    $("#peakTime").textContent = analysis.otherMessages.length ? `${String(peakHour).padStart(2, "0")}:00 PEAK` : "NO DATA";
  }

  function drawLatencyChart(events) {
    const canvas = $("#latencyChart");
    if (!canvas || canvas.closest("[hidden]") || !canvas.offsetWidth) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(300, rect.width);
    const height = Math.max(260, rect.height || 520);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const style = getComputedStyle(document.documentElement);
    const colors = {
      line: style.getPropertyValue("--line").trim(),
      muted: style.getPropertyValue("--muted-2").trim(),
      text: style.getPropertyValue("--text").trim(),
      blue: style.getPropertyValue("--blue").trim(),
      amber: style.getPropertyValue("--amber").trim()
    };
    const pad = { left: 58, right: 20, top: 24, bottom: 48 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const values = events.map(event => event.minutes);
    const data = values.length ? values : [0];
    const maxValue = Math.max(60, ...data);
    const scaleValue = value => Math.log1p(value) / Math.log1p(maxValue);

    ctx.font = "10px SFMono-Regular, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    for (let tick = 0; tick <= 4; tick += 1) {
      const y = pad.top + plotH - plotH * (tick / 4);
      ctx.strokeStyle = colors.line;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
      const raw = Math.expm1(Math.log1p(maxValue) * tick / 4);
      ctx.fillStyle = colors.muted;
      ctx.textAlign = "right";
      ctx.fillText(formatDuration(raw), pad.left - 10, y);
    }
    if (!events.length) {
      ctx.fillStyle = colors.muted;
      ctx.textAlign = "center";
      ctx.font = "13px Inter, sans-serif";
      ctx.fillText("No reply transitions available", pad.left + plotW / 2, pad.top + plotH / 2);
      return;
    }
    const xFor = index => events.length === 1 ? pad.left + plotW / 2 : pad.left + plotW * index / (events.length - 1);
    const yFor = value => pad.top + plotH - scaleValue(value) * plotH;
    ctx.strokeStyle = colors.blue;
    ctx.lineWidth = 2;
    ctx.beginPath();
    events.forEach((event, index) => {
      const x = xFor(index), y = yFor(event.minutes);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    events.forEach((event, index) => {
      const x = xFor(index), y = yFor(event.minutes);
      ctx.fillStyle = event.minutes === Math.max(...values) ? colors.amber : colors.blue;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors.muted;
      ctx.textAlign = "center";
      ctx.font = "9px SFMono-Regular, Consolas, monospace";
      ctx.fillText(`#${index + 1}`, x, height - 20);
    });
  }

  function updateSimulator() {
    const analysis = state.analysis;
    if (!analysis) return;
    const wait = Number($("#waitSlider").value);
    const length = Number($("#lengthSlider").value);
    const emoji = Number($("#emojiSlider").value);
    const desperation = Number($("#desperationSlider").value);
    const hello = $("#helloToggle").checked;
    $("#waitOutput").textContent = `${wait} h`;
    $("#lengthOutput").textContent = `${length} chars`;
    $("#emojiOutput").textContent = String(emoji);
    $("#desperationOutput").textContent = `${desperation}%`;
    const baseRisk = analysis.score;
    const damage = clamp((baseRisk * .62 + desperation * .42 + emoji * 3.1 + (hello ? 24 : 0) + (wait > 0 ? 8 : 0) - Math.min(wait, 24) * .08), 0, 100);
    const reply = clamp(61 - baseRisk * .40 + Math.min(wait, 48) * .22 - desperation * .16 - (hello ? 11 : 0), 1, 88);
    const regret = clamp(damage * .93 + (hello ? 13 : 0) + (emoji > 4 ? 7 : 0), 7, 99.999);
    $("#simDamage").textContent = Math.round(damage);
    $("#replyProb").textContent = `${Math.round(reply)}%`;
    $("#regretProb").textContent = `${Math.round(regret)}%`;
    $("#replyBar").style.width = `${reply}%`;
    $("#regretBar").style.width = `${regret}%`;
    let title, explanation;
    if (damage > 78) {
      title = "Abort mission. Preserve the remaining dignity.";
      explanation = "This timeline produces severe second-message exposure with a high projected regret rate.";
    } else if (wait < 4) {
      title = "Too soon. Let the first message breathe.";
      explanation = "The current wait time is shorter than the observed reply pattern. No escalation is justified.";
    } else if (reply > 55 && desperation < 45) {
      title = "Proceed carefully—without “hello??”.";
      explanation = "A clear, useful follow-up may be defensible. Avoid adding pressure or manufacturing urgency.";
    } else {
      title = "Wait. Protect the remaining dignity.";
      explanation = "The expected reply benefit does not currently justify the second-message exposure.";
    }
    $("#simRecommendation").textContent = title;
    $("#simExplanation").textContent = explanation;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportJson() {
    if (!state.analysis) return;
    const a = state.analysis;
    const payload = {
      caseId: a.caseId,
      disclaimer: "Entertainment only. Messaging patterns do not prove intention.",
      model: "IGN-1.0",
      catastrophicAbandonmentIndex: Number(a.score.toFixed(6)),
      evidenceQuality: a.quality,
      metrics: {
        messageCount: a.messages.length,
        medianReplyMinutes: Number(a.medianReply.toFixed(2)),
        p90ReplyMinutes: Number(a.p90Reply.toFixed(2)),
        longestSilenceMinutes: Number(a.longestSilence.toFixed(2)),
        selfEffortShare: Number(a.effortShare.toFixed(3)),
        unansweredQuestions: a.unansweredQuestions.length,
        doubleTextMessages: a.doubleTextMessages,
        dryReplyRate: Number(a.dryRate.toFixed(3)),
        conversationDecay: Number(a.conversationDecay.toFixed(3))
      },
      evidence: a.evidence.map(({ title, detail, severity }) => ({ title, detail, severity }))
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `${a.caseId.toLowerCase()}-evidence.json`);
    toast("Evidence data exported");
  }

  function saveVerdictCard() {
    if (!state.analysis) return;
    const a = state.analysis;
    const verdict = verdictFor(a.score);
    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 630;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0b0c0e"; ctx.fillRect(0, 0, 1200, 630);
    ctx.strokeStyle = "#2a2e36"; ctx.lineWidth = 2; ctx.strokeRect(30, 30, 1140, 570);
    ctx.fillStyle = "#f0ad4e"; ctx.fillRect(70, 72, 48, 48);
    ctx.fillStyle = "#17110a"; ctx.font = "800 18px Arial"; ctx.textAlign = "center"; ctx.fillText("AI", 94, 103);
    ctx.textAlign = "left"; ctx.fillStyle = "#f5f2eb"; ctx.font = "700 20px Arial"; ctx.fillText("AM I BEING IGNORED?", 136, 92);
    ctx.fillStyle = "#949aa5"; ctx.font = "14px Arial"; ctx.fillText(`OFFICIAL CASE VERDICT · #${a.caseId}`, 136, 116);
    ctx.fillStyle = "#f5f2eb"; ctx.font = "700 74px Arial"; ctx.fillText(verdict.label, 70, 250);
    ctx.fillStyle = "#949aa5"; ctx.font = "24px Arial"; ctx.fillText(verdict.title, 72, 292);
    ctx.fillStyle = verdict.color.includes("green") ? "#6dca9c" : a.score < 65 ? "#f0ad4e" : "#ef6a5b";
    ctx.font = "800 178px Arial"; ctx.textAlign = "right"; ctx.fillText(a.score.toFixed(4), 1128, 278);
    ctx.fillStyle = "#949aa5"; ctx.font = "700 14px Arial"; ctx.fillText("CATASTROPHIC ABANDONMENT INDEX™", 1122, 315);
    ctx.textAlign = "left";
    const metrics = [["MEDIAN REPLY", formatDuration(a.medianReply)], ["LONGEST SILENCE", formatDuration(a.longestSilence)], ["YOUR EFFORT", `${Math.round(a.effortShare * 100)}%`], ["EVIDENCE QUALITY", `${a.quality}%`]];
    metrics.forEach(([label, value], index) => {
      const x = 70 + index * 274;
      ctx.strokeStyle = "#2a2e36"; ctx.beginPath(); ctx.moveTo(x, 390); ctx.lineTo(x + 230, 390); ctx.stroke();
      ctx.fillStyle = "#949aa5"; ctx.font = "12px Arial"; ctx.fillText(label, x, 425);
      ctx.fillStyle = "#f5f2eb"; ctx.font = "700 28px Arial"; ctx.fillText(value, x, 465);
    });
    ctx.fillStyle = "#69717d"; ctx.font = "14px Arial"; ctx.fillText("Entertainment only. Behavior is measurable; intention is not.", 70, 555);
    canvas.toBlob(blob => {
      if (blob) downloadBlob(blob, `${a.caseId.toLowerCase()}-verdict.png`);
      toast("Verdict card saved");
    }, "image/png");
  }

  async function runOcr() {
    if (!state.imageFile) return toast("Choose a screenshot first");
    const button = $("#runOcr");
    const status = $("#ocrState");
    if (!window.Tesseract) {
      status.textContent = "OCR library unavailable offline";
      toast("OCR needs an internet connection. TXT and paste analysis remain offline.", 4200);
      return;
    }
    button.disabled = true;
    button.textContent = "Extracting…";
    try {
      const result = await window.Tesseract.recognize(state.imageFile, "eng", {
        logger: message => {
          if (message.status === "recognizing text") status.textContent = `Recognizing · ${Math.round((message.progress || 0) * 100)}%`;
          else status.textContent = message.status.replace(/\b\w/g, letter => letter.toUpperCase());
        }
      });
      const raw = result.data.text.trim();
      if (!raw) throw new Error("No readable text was detected");
      const lines = raw.split("\n").map(line => line.trim()).filter(line => line.length > 1);
      const alreadyStructured = lines.some(line => /\d{1,2}:\d{2}/.test(line) && /:/.test(line));
      const formatted = alreadyStructured ? raw : lines.map((line, index) => `${index % 2 ? "You" : "Other"}: ${line}`).join("\n");
      elements.chatInput.value = formatted;
      state.source = "screenshot";
      refreshInputStats();
      $$(".source-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.source === "paste"));
      $$(".source-pane").forEach(pane => pane.classList.toggle("active", pane.dataset.pane === "paste"));
      status.textContent = `OCR complete · ${Math.round(result.data.confidence || 0)}% confidence`;
      toast("Text extracted. Review sender labels before analysis.", 4200);
    } catch (error) {
      status.textContent = "Extraction failed";
      toast(error.message || "OCR failed. Try a higher-resolution screenshot.", 4200);
    } finally {
      button.disabled = false;
      button.textContent = "Extract text";
    }
  }

  function handleAnalyze() {
    const messages = parseConversation(elements.chatInput.value);
    const participants = [...new Set(messages.map(message => message.sender))];
    if (messages.length < 4) return toast("Add at least four recognizable messages or load a demo case.", 3600);
    if (participants.length < 2) return toast("Two senders are required. Format messages as “Name: message”.", 4200);
    const selected = elements.selfSelect.value;
    const selfName = selected || participants.find(name => /^(you|me|myself)$/i.test(name)) || participants[0];
    state.messages = messages;
    state.analysis = analyze(messages, selfName);
    runScan(state.analysis);
  }

  function setupTabs() {
    $$(".source-tab").forEach(tab => tab.addEventListener("click", () => {
      state.source = tab.dataset.source;
      $$(".source-tab").forEach(item => {
        const active = item === tab;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
      });
      $$(".source-pane").forEach(pane => pane.classList.toggle("active", pane.dataset.pane === tab.dataset.source));
    }));
    $$(".result-tab").forEach(tab => tab.addEventListener("click", () => {
      $$(".result-tab").forEach(item => {
        const active = item === tab;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
      });
      $$(".result-view").forEach(panel => panel.classList.toggle("active", panel.dataset.viewPanel === tab.dataset.view));
      if (tab.dataset.view === "overview") requestAnimationFrame(() => drawLatencyChart(state.analysis?.replyEvents || []));
      beep("tick");
    }));
  }


  function finalPanicFinale() {
    if (!state.analysis) return;
    const a = state.analysis;
    createEmojiRain(true);
    beep("reveal");
    $("#flashText").textContent = "HOPE DELISTED";
    const flash = $("#verdictFlash");
    flash.classList.add("show");
    setTimeout(() => flash.classList.remove("show"), 1700);
    toast(`Final demo mode: ${a.score.toFixed(6)}% crisis, 0 useful outcomes, ${a.doubleTextMessages} dignity liabilities. 🪦`, 6200);
    document.body.classList.add("final-panic");
    setTimeout(() => document.body.classList.remove("final-panic"), 5200);
  }

  function bindEvents() {
    setupTabs();
    $("#caseNumber").textContent = `#${state.caseId}`;
    elements.chatInput.addEventListener("input", refreshInputStats);
    $("#clearInput").addEventListener("click", () => { elements.chatInput.value = ""; refreshInputStats(); elements.chatInput.focus(); });
    $$('[data-sample]').forEach(button => button.addEventListener("click", () => {
      elements.chatInput.value = samples[button.dataset.sample];
      state.source = "paste";
      refreshInputStats();
      beep("tick");
      toast(`${button.dataset.sample[0].toUpperCase()}${button.dataset.sample.slice(1)} case loaded`);
    }));
    $("#fileInput").addEventListener("change", event => {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) return toast("That export is larger than 10 MB.");
      const reader = new FileReader();
      reader.onload = () => {
        elements.chatInput.value = String(reader.result || "");
        state.source = "file";
        refreshInputStats();
        $("#fileState").hidden = false;
        $("#fileState").innerHTML = `<b>${escapeHtml(file.name)}</b><span>${formatNumber(file.size / 1024)} KB · READY</span>`;
        toast("Chat export loaded locally");
      };
      reader.readAsText(file);
    });
    $("#imageInput").addEventListener("change", event => {
      const file = event.target.files[0];
      if (!file) return;
      state.imageFile = file;
      state.source = "screenshot";
      const url = URL.createObjectURL(file);
      $("#imagePreview").src = url;
      $("#imageName").textContent = file.name;
      $("#ocrState").textContent = "Ready for OCR";
      $("#imageStage").hidden = false;
    });
    $("#runOcr").addEventListener("click", runOcr);
    elements.analyzeButton.addEventListener("click", handleAnalyze);
    $("#soundToggle").addEventListener("click", event => {
      state.sound = !state.sound;
      event.currentTarget.setAttribute("aria-pressed", String(state.sound));
      if (state.sound) beep("good");
    });
    $("#newCase").addEventListener("click", () => {
      state.analysis = null;
      state.caseId = `AIBI-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000 + 1000))}`;
      $("#caseNumber").textContent = `#${state.caseId}`;
      showScreen("input");
    });
    $$("#modeSwitch button").forEach(button => button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      $$("#modeSwitch button").forEach(item => item.classList.toggle("active", item === button));
      $("#modeNarration").textContent = narrationFor(state.mode, state.analysis);
      beep("tick");
    }));
    $("#panicFinale").addEventListener("click", finalPanicFinale);
    $("#exportJson").addEventListener("click", exportJson);
    $("#shareVerdict").addEventListener("click", saveVerdictCard);
    $("#mournButton").addEventListener("click", () => {
      document.title = "🪦 This conversation has passed away";
      beep("reveal");
      toast("A completely unnecessary mourning period has begun 🥀", 4200);
      createEmojiRain(true);
    });
    $("#deliverVerdict").addEventListener("click", () => {
      const a = state.analysis;
      if (!a) return;
      const ruling = a.score >= 84 ? "Guilty of aggravated conversational negligence" : a.score >= 65 ? "Guilty with plausible deniability" : a.score >= 42 ? "Suspicious, but reasonable doubt survives" : "Acquitted due to insufficient emotional damage";
      $("#courtRuling").textContent = ruling;
      $("#courtReason").textContent = `The court considered ${a.messages.length} messages, ${a.replyEvents.length} reply transitions, and evidence quality of ${a.quality}%.`;
      $("#flashText").textContent = a.score >= 65 ? "GUILTY" : a.score >= 42 ? "SUSPICIOUS" : "ACQUITTED";
      const flash = $("#verdictFlash");
      flash.classList.add("show");
      beep(a.score < 42 ? "good" : "gavel");
      setTimeout(() => flash.classList.remove("show"), 1450);
    });
    $("#verdictFlash").addEventListener("click", event => event.currentTarget.classList.remove("show"));
    $("#rainToggle").addEventListener("change", event => $("#emojiRain").hidden = !event.target.checked);
    ["waitSlider", "lengthSlider", "emojiSlider", "desperationSlider", "helloToggle"].forEach(id => $("#" + id).addEventListener("input", updateSimulator));
    window.addEventListener("resize", () => {
      clearTimeout(state.redrawTimer);
      state.redrawTimer = setTimeout(() => state.analysis && drawLatencyChart(state.analysis.replyEvents), 120);
    });
  }

  function createEmojiRain(intense = false) {
    const rain = $("#emojiRain");
    const emojis = ["🥀", "💀", "📉", "🪦", "😭", "🫠", "🤡", "🕯️"];
    rain.innerHTML = Array.from({ length: intense ? 38 : 18 }, (_, index) => {
      const left = (index * 37.7) % 100;
      const duration = 8 + (index % 7) * 1.7;
      const delay = -(index % 9) * 1.3;
      const size = 12 + (index % 4) * 4;
      return `<i style="left:${left}%;animation-duration:${duration}s;animation-delay:${delay}s;font-size:${size}px">${emojis[index % emojis.length]}</i>`;
    }).join("");
  }

  bindEvents();
  createEmojiRain();
  elements.chatInput.value = samples.catastrophic;
  refreshInputStats();
})();
