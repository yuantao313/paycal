const HOLIDAY_ICS_URL = "https://calendars.icloud.com/holidays/cn_zh.ics";

export async function handleRequest(request) {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return textResponse("ok");
  }

  if (url.pathname === "/payday.ics") {
    const options = parseOptions(url);
    const calendar = await buildHolidayCalendar(options.years);
    const events = buildPaydayEvents(options, calendar);
    return icsResponse(buildCalendar(events, options.paydayName), options.paydayFileName);
  }

  if (url.pathname === "/month-end-saturday.ics") {
    const options = parseOptions(url);
    const calendar = await buildHolidayCalendar(expandLookupYears(options.years));
    const events = await buildMonthEndSaturdayEvents(options, calendar);
    return icsResponse(buildCalendar(events, options.saturdayName), options.saturdayFileName);
  }

  if (url.pathname === "/combined.ics") {
    const options = parseOptions(url);
    const calendar = await buildHolidayCalendar(expandLookupYears(options.years));
    const payday = buildPaydayEvents(options, calendar);
    const saturday = await buildMonthEndSaturdayEvents(options, calendar);
    return icsResponse(
      buildCalendar([...payday, ...saturday], options.combinedName),
      options.combinedFileName,
    );
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    return htmlResponse(renderHome(url));
  }

  return textResponse("Not found", 404);
}

export function parseOptions(url) {
  const day = clampInt(url.searchParams.get("day"), 15, 1, 31);
  const strategy = parseStrategy(url.searchParams);
  const years = parseYears(url.searchParams);
  const paydayLabel = strategy === "advance" ? `${day}日+提前` : strategy === "delay" ? `${day}日+延后` : `${day}日`;
  const paydayName = cleanText(url.searchParams.get("paydayName") || url.searchParams.get("name")) || `公司发薪日（${paydayLabel}）`;
  const saturdayName = cleanText(url.searchParams.get("saturdayName")) || "月末周六（班）";

  return {
    day,
    strategy,
    years,
    paydayName,
    saturdayName,
    combinedName: `${paydayName} + ${saturdayName}`,
    paydayFileName: `payday-${day}-${strategy}.ics`,
    saturdayFileName: "month-end-saturday.ics",
    combinedFileName: `payday-${day}-${strategy}-with-saturday.ics`,
  };
}

export async function buildHolidayCalendar(years, fetcher = globalThis.fetch) {
  const holidays = new Set();
  const tiaoxiu = new Set();

  try {
    const resp = await fetcher(HOLIDAY_ICS_URL, cacheOptions(86400));
    if (resp.ok) {
      const text = await resp.text();
      const parsed = parseHolidayIcs(text);
      for (const date of parsed.holidays) {
        holidays.add(date);
      }
      for (const date of parsed.tiaoxiu) {
        tiaoxiu.add(date);
      }
    }
  } catch (_error) {
    // Holiday calendar is best effort; fall back to weekend-only logic.
  }

  return {
    isHoliday(date) {
      return holidays.has(formatDate(date));
    },
    async isTiaoxiu(date) {
      return tiaoxiu.has(formatDate(date));
    },
    isTiaoxiuSync(date) {
      return tiaoxiu.has(formatDate(date));
    },
    async isRestDay(date) {
      const ds = formatDate(date);
      if (holidays.has(ds)) {
        return true;
      }
      if (tiaoxiu.has(ds)) {
        return false;
      }
      const weekday = date.getUTCDay();
      if (weekday === 0 || weekday === 6) {
        return true;
      }
      return false;
    },
  };
}

export function buildPaydayEvents(options, calendar) {
  const events = [];
  for (const year of options.years) {
    for (let month = 1; month <= 12; month += 1) {
      const actual = resolvePayday(year, month, options.day, options.strategy, calendar);
      const title = `${year}年${month}月发薪日`;
      events.push({
        uid: `payday-${options.day}-${options.strategy}-${formatDate(actual)}`,
        title,
        start: actual,
        end: addDays(actual, 1),
        description: `${title}\n规则：每月 ${options.day} 日；${describeStrategy(options.strategy)}`,
      });
    }
  }
  return events;
}

export function resolvePayday(year, month, day, strategy, calendar) {
  const cappedDay = Math.min(day, daysInMonth(year, month));
  let current = makeDate(year, month, cappedDay);

  if (strategy === "none") {
    return current;
  }

  const step = strategy === "advance" ? -1 : 1;
  for (let i = 0; i < 31; i += 1) {
    if (!isRestDaySync(current, calendar)) {
      return current;
    }
    current = addDays(current, step);
  }
  return current;
}

export async function buildMonthEndSaturdayEvents(options, calendar) {
  const events = [];
  for (const year of options.years) {
    for (let month = 1; month <= 12; month += 1) {
      const saturday = lastSaturday(year, month);
      if (!(await shouldWorkMonthEndSaturday(saturday, calendar))) {
        continue;
      }
      const title = `${year}年${month}月末周六（班）`;
      events.push({
        uid: `month-end-saturday-${formatDate(saturday)}`,
        title,
        start: saturday,
        end: addDays(saturday, 1),
        description: `${title}\n规则：仅当是正常周六且不会形成连续工作 7 天以上时才加入`,
      });
    }
  }
  return events;
}

export async function shouldWorkMonthEndSaturday(saturday, calendar) {
  if (calendar.isHoliday(saturday)) {
    return false;
  }
  if (await calendar.isTiaoxiu(saturday)) {
    return false;
  }
  let consecutive = 1;

  let cursor = addDays(saturday, -1);
  for (let i = 0; i < 31; i += 1) {
    if (await calendar.isRestDay(cursor)) {
      break;
    }
    consecutive += 1;
    if (consecutive >= 7) {
      return false;
    }
    cursor = addDays(cursor, -1);
  }

  cursor = addDays(saturday, 1);
  for (let i = 0; i < 31; i += 1) {
    if (await calendar.isRestDay(cursor)) {
      break;
    }
    consecutive += 1;
    if (consecutive >= 7) {
      return false;
    }
    cursor = addDays(cursor, 1);
  }

  return true;
}

export function buildCalendar(events, calendarName) {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//paycal//ICS//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
  ];

  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcs(event.uid)}@paycal`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${formatDateCompact(event.start)}`,
      `DTEND;VALUE=DATE:${formatDateCompact(event.end)}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      `DESCRIPTION:${escapeIcs(event.description)}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return foldIcsLines(lines).join("\r\n") + "\r\n";
}

export function renderHome(url) {
  const origin = url.origin;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>发薪日与月末周六订阅</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f7f7f4; color: #202521; }
    main { width: min(980px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0; }
    h1 { margin: 0 0 20px; font-size: 28px; line-height: 1.2; }
    form { display: grid; gap: 18px; }
    fieldset { margin: 0; padding: 0; border: 0; }
    legend { margin: 0 0 10px; font-weight: 700; }
    label { display: grid; gap: 8px; font-size: 14px; }
    input, select { min-height: 40px; padding: 0 10px; border: 1px solid #c6c7be; border-radius: 6px; background: transparent; color: inherit; font: inherit; }
    button { min-height: 42px; border: 0; border-radius: 6px; background: #23685f; color: #fff; font: inherit; cursor: pointer; }
    button.secondary { min-height: 36px; padding: 0 12px; border: 1px solid #c6c7be; background: transparent; color: inherit; }
    .row { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    .check { display: flex; align-items: center; gap: 10px; }
    .check input { min-height: auto; }
    .controls { padding: 18px; border: 1px solid #d8d8cf; border-radius: 8px; background: #fff; }
    .subscriptions { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .subscription { min-height: 132px; padding: 16px; border: 1px solid #d8d8cf; border-radius: 8px; background: #fff; cursor: pointer; }
    .subscription:has(input:checked) { border-color: #23685f; box-shadow: inset 0 0 0 1px #23685f; }
    .subscription input { min-height: auto; margin: 2px 0 0; }
    .subscription-head { display: flex; align-items: flex-start; gap: 10px; font-weight: 700; }
    .subscription p { margin: 10px 0 0 28px; color: #5a625d; line-height: 1.5; }
    output { display: grid; gap: 10px; min-height: 54px; padding: 14px; border-radius: 6px; background: #edf4f1; overflow-wrap: anywhere; }
    .result-item { display: grid; gap: 8px; padding: 10px 0; border-bottom: 1px solid rgba(32, 37, 33, 0.12); }
    .result-item:last-child { border-bottom: 0; }
    .result-title { font-weight: 700; }
    .result-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    a { color: #135e55; }
    @media (prefers-color-scheme: dark) {
      body { background: #161817; color: #edf2ee; }
      .controls, .subscription { background: #202322; border-color: #3e4743; }
      input, select { border-color: #58625e; }
      .subscription:has(input:checked) { border-color: #8ed8ca; box-shadow: inset 0 0 0 1px #8ed8ca; }
      .subscription p { color: #b8c2bc; }
      output { background: #1e2d2a; }
      .result-item { border-bottom-color: rgba(237, 242, 238, 0.14); }
      a { color: #8ed8ca; }
    }
  </style>
</head>
<body>
  <main>
    <h1>发薪日与月末周六订阅</h1>
    <form id="form">
      <fieldset class="controls">
        <legend>规则</legend>
        <div class="row">
      <label>每月几号发薪
            <input id="day" type="number" min="1" max="31" value="15" required>
          </label>
          <label>生成年份
            <select id="span">
              <option value="2">当年 + 明年</option>
              <option value="3">去年 + 当年 + 明年</option>
              <option value="5">连续 5 年</option>
            </select>
          </label>
        </div>
        <label class="check">
          <input id="advance" type="checkbox" checked>
          发薪日遇休息日提前
        </label>
      </fieldset>
      <fieldset>
        <legend>订阅</legend>
        <div class="subscriptions">
          <label class="subscription" data-calendar="payday">
            <span class="subscription-head">
              <input type="checkbox" name="calendar" value="payday" checked>
              <span>发薪日</span>
            </span>
            <p>公司发薪日，默认 15 日，遇休息日提前。</p>
          </label>
          <label class="subscription" data-calendar="month-end-saturday">
            <span class="subscription-head">
              <input type="checkbox" name="calendar" value="month-end-saturday" checked>
              <span>月末周六（班）</span>
            </span>
            <p>每月最后一个普通周六，且不会把整段工作日拉成 7 天连班时才会生成。</p>
          </label>
          <label class="subscription" data-calendar="combined">
            <span class="subscription-head">
              <input type="checkbox" name="calendar" value="combined" checked>
              <span>合并订阅</span>
            </span>
            <p>把发薪日和月末周六合并到一个日历。</p>
          </label>
        </div>
      </fieldset>
      <button type="submit">生成订阅链接</button>
    </form>
    <output id="result"></output>
  </main>
  <script>
    const origin = ${JSON.stringify(origin)};
    const form = document.querySelector("#form");
    const result = document.querySelector("#result");
    const calendars = {
      payday: { name: "发薪日", path: "/payday.ics" },
      "month-end-saturday": { name: "月末周六（班）", path: "/month-end-saturday.ics" },
      combined: { name: "合并订阅", path: "/combined.ics" },
    };
    function years() {
      const span = Number(document.querySelector("#span").value || "2");
      const now = new Date().getUTCFullYear();
      const start = span === 3 ? now - 1 : now;
      return Array.from({ length: span }, (_, i) => start + i).join(",");
    }
    function link(path) {
      const params = new URLSearchParams({
        day: document.querySelector("#day").value || "15",
        advance: document.querySelector("#advance").checked ? "1" : "0",
        years: years(),
      });
      return origin + path + "?" + params.toString();
    }
    function selectedCalendars() {
      return Array.from(document.querySelectorAll('input[name="calendar"]:checked'))
        .map((input) => calendars[input.value])
        .filter(Boolean);
    }
    function escapeHtml(value) {
      return value.replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char]));
    }
    function render() {
      const selected = selectedCalendars();
      if (selected.length === 0) {
        result.innerHTML = "请选择至少一个订阅。";
        return;
      }
      result.innerHTML = selected.map((item) => {
        const href = link(item.path);
        const safeHref = escapeHtml(href);
        return '<div class="result-item">' +
          '<div class="result-title">' + escapeHtml(item.name) + '</div>' +
          '<div class="result-actions">' +
          '<a href="' + safeHref + '">' + safeHref + '</a>' +
          '<button class="secondary" type="button" data-copy="' + safeHref + '">复制</button>' +
          '</div>' +
          '</div>';
      }).join("");
    }
    form.addEventListener("submit", (event) => { event.preventDefault(); render(); });
    form.addEventListener("input", render);
    result.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-copy]");
      if (!button) {
        return;
      }
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "已复制";
      setTimeout(() => { button.textContent = "复制"; }, 1200);
    });
    render();
  </script>
</body>
</html>`;
}

export function lastSaturday(year, month) {
  let day = makeDate(year, month, daysInMonth(year, month));
  while (day.getUTCDay() !== 6) {
    day = addDays(day, -1);
  }
  return day;
}

export function makeTestCalendar({ holidays = [], tiaoxiu = [] } = {}) {
  const holidaySet = new Set(holidays);
  const tiaoxiuSet = new Set(tiaoxiu);
  return {
    isHoliday(date) {
      return holidaySet.has(formatDate(date));
    },
    async isTiaoxiu(date) {
      return tiaoxiuSet.has(formatDate(date));
    },
    isTiaoxiuSync(date) {
      return tiaoxiuSet.has(formatDate(date));
    },
    async isRestDay(date) {
      if (holidaySet.has(formatDate(date))) {
        return true;
      }
      const weekday = date.getUTCDay();
      if (weekday === 0 || weekday === 6) {
        return !tiaoxiuSet.has(formatDate(date));
      }
      return false;
    },
  };
}

function parseHolidayIcs(text) {
  const holidays = new Set();
  const tiaoxiu = new Set();
  let event = null;

  for (const line of unfoldIcsLines(text)) {
    if (line === "BEGIN:VEVENT") {
      event = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (event) {
        const kind = classifyHolidayEvent(event);
        if (kind) {
          const dates = expandDateRange(event.start, event.end);
          for (const date of dates) {
            if (kind === "holiday") {
              holidays.add(date);
            } else {
              tiaoxiu.add(date);
            }
          }
        }
      }
      event = null;
      continue;
    }
    if (!event) {
      continue;
    }

    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = line.slice(0, colon).split(";")[0].toUpperCase();
    const value = line.slice(colon + 1).trim();
    if (key === "DTSTART") {
      event.start = value;
    } else if (key === "DTEND") {
      event.end = value;
    } else if (key === "SUMMARY") {
      event.summary = value;
    } else if (key === "X-APPLE-SPECIAL-DAY") {
      event.specialDay = value;
    }
  }

  return { holidays, tiaoxiu };
}

function classifyHolidayEvent(event) {
  const summary = event.summary || "";
  const specialDay = event.specialDay || "";
  if (summary.includes("（休）") || specialDay === "WORK-HOLIDAY") {
    return "holiday";
  }
  if (summary.includes("（班）") || specialDay === "ALTERNATE-WORKDAY") {
    return "tiaoxiu";
  }
  return null;
}

function expandDateRange(start, end) {
  if (!start) {
    return [];
  }
  const dates = [];
  let cursor = parseIcsDate(start);
  const limit = end ? parseIcsDate(end) : addDays(cursor, 1);
  while (cursor < limit) {
    dates.push(formatDate(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function parseIcsDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value);
  if (!match) {
    return new Date(NaN);
  }
  return makeDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function unfoldIcsLines(text) {
  const lines = text.split(/\r?\n/);
  const unfolded = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else if (line) {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function parseStrategy(searchParams) {
  const explicit = searchParams.get("strategy");
  if (["advance", "delay", "none"].includes(explicit)) {
    return explicit;
  }
  return parseBool(searchParams.get("advance"), true) ? "advance" : "none";
}

function parseYears(searchParams) {
  const raw = searchParams.get("years");
  if (raw) {
    const years = raw.split(",")
      .map((x) => Number.parseInt(x.trim(), 10))
      .filter((x) => Number.isInteger(x) && x >= 1970 && x <= 2100);
    if (years.length > 0) {
      return [...new Set(years)].sort((a, b) => a - b);
    }
  }

  const currentYear = new Date().getUTCFullYear();
  return [currentYear, currentYear + 1];
}

function expandLookupYears(years) {
  const result = new Set(years);
  for (const year of years) {
    result.add(year - 1);
    result.add(year + 1);
  }
  return [...result].sort((a, b) => a - b);
}

function isRestDaySync(date, calendar) {
  if (calendar.isHoliday(date)) {
    return true;
  }
  if (typeof calendar.isTiaoxiuSync === "function" && calendar.isTiaoxiuSync(date)) {
    return false;
  }
  const weekday = date.getUTCDay();
  return weekday === 0 || weekday === 6;
}

function cacheOptions(seconds) {
  return { cf: { cacheTtl: seconds, cacheEverything: true } };
}

function parseBool(value, defaultValue) {
  if (value == null) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function cleanText(value) {
  return (value || "").trim().slice(0, 80);
}

function describeStrategy(strategy) {
  if (strategy === "advance") {
    return "如遇休息日，提前至最近的工作日";
  }
  if (strategy === "delay") {
    return "如遇休息日，延后至最近的工作日";
  }
  return "不因休息日调整";
}

function makeDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateCompact(date) {
  return formatDate(date).replace(/-/g, "");
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLines(lines) {
  const folded = [];
  for (const line of lines) {
    if (line.length <= 75) {
      folded.push(line);
      continue;
    }
    let rest = line;
    folded.push(rest.slice(0, 75));
    rest = rest.slice(75);
    while (rest.length > 74) {
      folded.push(` ${rest.slice(0, 74)}`);
      rest = rest.slice(74);
    }
    if (rest) {
      folded.push(` ${rest}`);
    }
  }
  return folded;
}

function htmlResponse(body) {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function icsResponse(body, fileName) {
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${fileName}"`,
      "cache-control": "public, max-age=3600",
    },
  });
}

function textResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
