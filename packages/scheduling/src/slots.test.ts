import { describe, expect, it } from "vitest";
import { computeSlots } from "./slots";

// Время — минуты от полуночи в часовом поясе салона (10:00 = 600).
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

describe("computeSlots", () => {
  it("offers start times across the whole working day on a fixed step", () => {
    const slots = computeSlots({
      working: [{ start: h(10), end: h(12) }],
      busy: [],
      durationMin: 60,
      stepMin: 30,
    });
    expect(slots).toEqual([h(10), h(10, 30), h(11)]);
  });

  it("does not offer a slot that would end after the working interval", () => {
    const slots = computeSlots({
      working: [{ start: h(10), end: h(11, 30) }],
      busy: [],
      durationMin: 60,
      stepMin: 30,
    });
    expect(slots).toEqual([h(10), h(10, 30)]);
  });

  it("skips slots overlapping an existing appointment", () => {
    const slots = computeSlots({
      working: [{ start: h(10), end: h(13) }],
      busy: [{ start: h(11), end: h(12) }],
      durationMin: 60,
      stepMin: 30,
    });
    // 10:30 заканчивается в 11:30 — пересекается; 12:00 свободно впритык
    expect(slots).toEqual([h(10), h(12)]);
  });

  it("treats back-to-back appointments as non-overlapping", () => {
    const slots = computeSlots({
      working: [{ start: h(10), end: h(12) }],
      busy: [{ start: h(10), end: h(11) }],
      durationMin: 60,
      stepMin: 60,
    });
    expect(slots).toEqual([h(11)]);
  });

  it("never offers a slot across a break between working intervals", () => {
    const slots = computeSlots({
      working: [
        { start: h(10), end: h(13) },
        { start: h(14), end: h(16) },
      ],
      busy: [],
      durationMin: 90,
      stepMin: 30,
    });
    expect(slots).toEqual([h(10), h(10, 30), h(11), h(11, 30), h(14), h(14, 30)]);
  });

  it("applies buffer after an appointment", () => {
    const slots = computeSlots({
      working: [{ start: h(10), end: h(13) }],
      busy: [{ start: h(10), end: h(11) }],
      durationMin: 60,
      stepMin: 30,
      bufferMin: 15,
    });
    // после 11:00 нужно 15 минут на уборку → ближайший старт 11:30
    expect(slots).toEqual([h(11, 30), h(12)]);
  });

  it("returns nothing when the service is longer than any free gap", () => {
    const slots = computeSlots({
      working: [{ start: h(10), end: h(11) }],
      busy: [],
      durationMin: 90,
      stepMin: 30,
    });
    expect(slots).toEqual([]);
  });

  it("returns nothing on a day off", () => {
    expect(
      computeSlots({ working: [], busy: [], durationMin: 30, stepMin: 30 }),
    ).toEqual([]);
  });

  it("rejects a non-positive duration or step", () => {
    expect(() =>
      computeSlots({ working: [], busy: [], durationMin: 0, stepMin: 30 }),
    ).toThrow();
    expect(() =>
      computeSlots({ working: [], busy: [], durationMin: 30, stepMin: 0 }),
    ).toThrow();
  });
});
