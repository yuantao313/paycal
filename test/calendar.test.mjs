import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCalendar,
  buildMonthEndSaturdayEvents,
  buildPaydayEvents,
  lastSaturday,
  makeTestCalendar,
  parseOptions,
  renderHome,
  resolvePayday,
  shouldWorkMonthEndSaturday,
} from "../src/calendar.js";

test("parseOptions defaults to 15 day advance", () => {
  const options = parseOptions(new URL("https://calendar.example/payday.ics"));

  assert.equal(options.day, 15);
  assert.equal(options.strategy, "advance");
  assert.match(options.paydayName, /15日\+提前/);
});

test("resolvePayday advances weekend to previous workday", () => {
  const calendar = makeTestCalendar();
  const actual = resolvePayday(2025, 6, 15, "advance", calendar);

  assert.equal(actual.toISOString().slice(0, 10), "2025-06-13");
});

test("resolvePayday can leave rest day unchanged", () => {
  const calendar = makeTestCalendar();
  const actual = resolvePayday(2025, 6, 15, "none", calendar);

  assert.equal(actual.toISOString().slice(0, 10), "2025-06-15");
});

test("buildPaydayEvents honors holidays", () => {
  const calendar = makeTestCalendar({ holidays: ["2025-09-15"] });
  const events = buildPaydayEvents(
    { day: 15, strategy: "advance", years: [2025] },
    calendar,
  );

  const september = events.find((event) => event.title === "2025年9月发薪日");
  assert.equal(september.start.toISOString().slice(0, 10), "2025-09-12");
});

test("lastSaturday finds month end Saturday", () => {
  assert.equal(lastSaturday(2025, 3).toISOString().slice(0, 10), "2025-03-29");
  assert.equal(lastSaturday(2025, 2).toISOString().slice(0, 10), "2025-02-22");
});

test("month end Saturday skips holiday and tiaoxiu", async () => {
  const holidayCalendar = makeTestCalendar({ holidays: ["2025-01-25"] });
  assert.equal(await shouldWorkMonthEndSaturday(new Date(Date.UTC(2025, 0, 25)), holidayCalendar), false);

  const tiaoxiuCalendar = makeTestCalendar({ tiaoxiu: ["2025-01-25"] });
  assert.equal(await shouldWorkMonthEndSaturday(new Date(Date.UTC(2025, 0, 25)), tiaoxiuCalendar), false);
});

test("month end Saturday skips seven day streak", async () => {
  const calendar = {
    isHoliday() {
      return false;
    },
    async isTiaoxiu() {
      return false;
    },
    async isRestDay() {
      return false;
    },
  };

  assert.equal(await shouldWorkMonthEndSaturday(new Date(Date.UTC(2025, 1, 1)), calendar), false);
});

test("buildMonthEndSaturdayEvents emits Saturday events", async () => {
  const calendar = makeTestCalendar();
  const events = await buildMonthEndSaturdayEvents({ years: [2025], maxStreak: 7 }, calendar);

  assert.ok(events.length >= 6);
  assert.ok(events.every((event) => event.start.getUTCDay() === 6));
});

test("buildCalendar emits ICS", () => {
  const ics = buildCalendar(
    [
      {
        uid: "test-1",
        title: "2025年6月发薪日",
        start: new Date(Date.UTC(2025, 5, 13)),
        end: new Date(Date.UTC(2025, 5, 14)),
        description: "公司发薪日",
      },
    ],
    "公司发薪日（15日+提前）",
  );

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;VALUE=DATE:20250613/);
  assert.match(ics, /SUMMARY:2025年6月发薪日/);
});

test("renderHome lists selectable calendar subscriptions", () => {
  const html = renderHome(new URL("https://calendar.example/"));

  assert.match(html, /data-calendar="payday"/);
  assert.match(html, /data-calendar="month-end-saturday"/);
  assert.match(html, /data-calendar="combined"/);
  assert.match(html, /\/payday\.ics/);
  assert.match(html, /\/month-end-saturday\.ics/);
  assert.match(html, /\/combined\.ics/);
});
