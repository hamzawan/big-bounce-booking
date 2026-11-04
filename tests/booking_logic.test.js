// Run with:  node --test tests/*.test.js
"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var L = require("../booking_logic.js");

var GENERAL = "01703189-46a1-4a67-899a-8e5cb9c4c588";
var VIP = "2716ff48-fa26-4a7b-8030-872c8005804c";
var SESSION = "068ba867-5f44-458b-b3a4-d9df0e482b72";
var MUG = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
var CAP = "5d7c0a1e-1b2c-4d3e-8f90-a1b2c3d4e5f6";

// A BookingResponseSchema as the backend returns it.
function booking(overrides) {
  return Object.assign({
    id: "b1",
    booking_number: "BK-0007",
    event_id: "e1",
    session_id: SESSION,
    customer_email: "a@example.com",
    quantity: 2,
    total_amount: "56.00",
    discount_id: null,
    discount_amount: "0.00",
    ticket_protection: false,
    protection_amount: "0.00",
    status: "pending",
    items: [{ id: "i1", ticket_type_id: GENERAL, quantity: 2, unit_price: "20.00", subtotal: "40.00" }],
    add_ons: [{ id: "a1", add_on_id: MUG, name: "Mug", quantity: 2, unit_price: "8.00", subtotal: "16.00", image: null }],
    ticket_subtotal: "40.00",
    add_ons_subtotal: "16.00"
  }, overrides);
}

function selection(overrides) {
  return Object.assign({
    sessionId: SESSION,
    tickets: {},
    addOns: {},
    email: "",
    ticketProtection: false,
    discountCode: ""
  }, overrides);
}

test("clampQuantity keeps whole numbers within bounds", function () {
  assert.equal(L.clampQuantity("3", 10), 3);
  assert.equal(L.clampQuantity(2.7, 10), 2);
  assert.equal(L.clampQuantity(-1, 10), 0);
  assert.equal(L.clampQuantity("abc", 10), 0);
  assert.equal(L.clampQuantity(250, L.MAX_ADD_ON_QUANTITY), 100);
});

test("createPayload matches BookingCreateSchema", function () {
  var body = L.createPayload(selection({
    tickets: { [GENERAL]: 2, [VIP]: 0 },
    addOns: { [MUG]: 2, [CAP]: 0 },
    email: "  a@example.com ",
    ticketProtection: true,
    discountCode: " save10 "
  }));

  assert.deepEqual(body, {
    items: [{ ticket_type_id: GENERAL, quantity: 2 }],
    session_id: SESSION,
    customer_email: "a@example.com",
    payment_provider: "stripe",
    ticket_protection: true,
    discount_code: "save10",
    add_ons: [{ add_on_id: MUG, quantity: 2 }]
  });

  // Never an amount, price or total.
  assert.ok(!/amount|price|total/.test(JSON.stringify(body)));
});

test("createPayload leaves out empty optional fields", function () {
  var body = L.createPayload(selection({ sessionId: null, tickets: { [GENERAL]: 1 } }));

  assert.deepEqual(body, {
    items: [{ ticket_type_id: GENERAL, quantity: 1 }],
    payment_provider: "stripe",
    ticket_protection: false,
    add_ons: []
  });
});

test("selectionFromBooking reads a booking back", function () {
  var s = L.selectionFromBooking(booking({ discount_id: "d1", ticket_protection: true }));

  assert.deepEqual(s.tickets, { [GENERAL]: 2 });
  assert.deepEqual(s.addOns, { [MUG]: 2 });
  assert.equal(s.sessionId, SESSION);
  assert.equal(s.ticketProtection, true);
  assert.equal(s.email, "a@example.com");
  // The response carries the discount's id, not its code.
  assert.equal(s.discountCode, undefined);
});

test("updatePayload is null when nothing changed", function () {
  var saved = L.selectionFromBooking(booking());
  assert.equal(L.updatePayload(saved, JSON.parse(JSON.stringify(saved))), null);

  // A zero quantity is the same as not chosen.
  var same = JSON.parse(JSON.stringify(saved));
  same.tickets[VIP] = 0;
  assert.equal(L.updatePayload(saved, same), null);
});

test("updatePayload sends only what changed", function () {
  var saved = L.selectionFromBooking(booking());
  var next = JSON.parse(JSON.stringify(saved));
  next.ticketProtection = true;

  assert.deepEqual(L.updatePayload(saved, next), { ticket_protection: true });

  next = JSON.parse(JSON.stringify(saved));
  next.tickets[VIP] = 1;

  assert.deepEqual(L.updatePayload(saved, next), {
    items: [
      { ticket_type_id: GENERAL, quantity: 2 },
      { ticket_type_id: VIP, quantity: 1 }
    ],
    session_id: SESSION
  });
});

test("updatePayload sends the whole add-on list, [] only when all removed", function () {
  var saved = L.selectionFromBooking(booking());
  var next = JSON.parse(JSON.stringify(saved));

  next.addOns[CAP] = 1;
  assert.deepEqual(L.updatePayload(saved, next).add_ons, [
    { add_on_id: MUG, quantity: 2 },
    { add_on_id: CAP, quantity: 1 }
  ]);

  next = JSON.parse(JSON.stringify(saved));
  next.addOns[MUG] = 0;
  assert.deepEqual(L.updatePayload(saved, next), { add_ons: [] });

  // Untouched add-ons are left out, so the backend keeps them.
  next = JSON.parse(JSON.stringify(saved));
  next.ticketProtection = true;
  assert.ok(!("add_ons" in L.updatePayload(saved, next)));
});

test("updatePayload applies, keeps and removes discount codes", function () {
  var saved = L.selectionFromBooking(booking());
  var next = Object.assign({}, saved, { discountCode: "SAVE10" });

  assert.deepEqual(L.updatePayload(saved, next), { discount_code: "SAVE10" });

  // A booking loaded with a discount keeps it unless it is removed.
  var withDiscount = L.selectionFromBooking(booking({ discount_id: "d1" }));
  var kept = Object.assign({}, withDiscount);
  assert.equal(L.updatePayload(withDiscount, kept), null);

  var removed = Object.assign({}, withDiscount, { discountCode: "" });
  assert.deepEqual(L.updatePayload(withDiscount, removed), { discount_code: null });

  // Codes match case-insensitively, as on the backend.
  var applied = Object.assign({}, saved, { discountCode: "save10" });
  assert.equal(L.updatePayload(applied, Object.assign({}, applied, { discountCode: "SAVE10 " })), null);
});

test("updatePayload never clears an email", function () {
  var saved = L.selectionFromBooking(booking());

  assert.equal(L.updatePayload(saved, Object.assign({}, saved, { email: "" })), null);
  assert.deepEqual(
    L.updatePayload(saved, Object.assign({}, saved, { email: "b@example.com" })),
    { customer_email: "b@example.com" }
  );
});

test("validate refuses what the backend would", function () {
  var limits = { [GENERAL]: { name: "General", max: 3 } };

  assert.deepEqual(L.validate(selection(), limits), ["Choose at least one ticket."]);
  assert.deepEqual(L.validate(selection({ tickets: { [GENERAL]: 3 } }), limits), []);
  assert.deepEqual(
    L.validate(selection({ tickets: { [GENERAL]: 4 } }), limits),
    ["Only 3 General tickets are left."]
  );
  assert.deepEqual(
    L.validate(selection({ tickets: { [GENERAL]: 1 }, email: "nope" }), limits),
    ["Enter a valid email address."]
  );
  assert.deepEqual(
    L.validate(selection({ tickets: { [GENERAL]: 1 }, addOns: { [MUG]: 101 } }), limits),
    ["An add-on can be booked at most 100 times."]
  );
});

test("estimate sums tickets and add-ons only, in cents", function () {
  var e = L.estimate(
    selection({ tickets: { [GENERAL]: 3 }, addOns: { [MUG]: 3 }, ticketProtection: true, discountCode: "X" }),
    { [GENERAL]: { price: "19.99" } },
    { [MUG]: { price: "0.10" } }
  );

  assert.deepEqual(e, { ticket_subtotal: "59.97", add_ons_subtotal: "0.30", total: "60.27" });
});

test("breakdown shows the backend's figures unchanged", function () {
  var b = L.breakdown(booking({
    total_amount: "56.30",
    discount_id: "d1",
    discount_amount: "4.00",
    ticket_protection: true,
    protection_amount: "5.40",
    ticket_subtotal: "40.00",
    add_ons_subtotal: "16.00"
  }));

  assert.deepEqual(b, {
    ticket_subtotal: "40.00",
    discount_amount: "4.00",
    has_discount: true,
    ticket_protection: true,
    protection_amount: "5.40",
    add_ons_subtotal: "16.00",
    total_amount: "56.30"
  });
});

test("describeError maps the backend's refusals", function () {
  function d(status, detail) { return L.describeError(status, { detail: detail }); }

  assert.equal(d(404, "Discount code not found.").field, "discount");
  assert.equal(d(409, "Discount code has expired.").message, "Discount code has expired.");
  assert.equal(d(409, "Discount code has reached its usage limit.").field, "discount");
  assert.equal(d(400, "Discount code does not apply to these tickets.").field, "discount");
  assert.equal(d(409, "Discount code was not active when this booking was made.").field, "discount");

  assert.equal(d(409, "Add-on is not available.").field, "addons");
  assert.equal(d(404, "Add-on not found.").field, "addons");
  assert.equal(d(400, "Not enough tickets available.").field, "tickets");

  assert.equal(d(409, "This booking's hold has expired.").kind, "expired");
  assert.equal(d(409, "Only a pending booking can be updated.").kind, "locked");
  assert.equal(
    d(409, "This booking has a payment in progress and cannot be repriced.").kind,
    "paying"
  );
  assert.equal(d(404, "Booking not found.").kind, "missing");

  var e = d(409, "Event is not on sale.");
  assert.deepEqual([e.field, e.kind, e.message], ["general", "retry", "Event is not on sale."]);

  assert.match(L.describeError(500, {}).message, /not saved/);
});

// A 100% code on every ticket (e.g. CMPLETE on 3 x General Admission) leaves
// 0.00, which is confirmed without Stripe instead of being refused.
test("isFree is true only when the backend's total is 0.00", function () {
  assert.equal(L.isFree(booking({ total_amount: "0.00", discount_amount: "40.00" })), true);
  assert.equal(L.isFree(booking({ total_amount: "0" })), true);
  assert.equal(L.isFree(booking({ total_amount: "0.01" })), false);
  assert.equal(L.isFree(booking()), false);
  assert.equal(L.isFree(null), false);
});

test("describeError treats an expired free confirmation as an expired hold", function () {
  assert.equal(L.describeError(410, { detail: "hold_expired" }).kind, "expired");
});

test("describeError flattens FastAPI validation errors", function () {
  var e = L.describeError(422, {
    detail: [{ loc: ["body", "add_ons", 0, "quantity"], msg: "Input should be less than or equal to 100" }]
  });

  assert.equal(e.message, "quantity: Input should be less than or equal to 100");
});

test("isValidEmail accepts normal addresses and rejects typos", function () {
  ["a@example.com", " a.b+c@mail.co.uk ", "x@y.io"].forEach(function (v) {
    assert.equal(L.isValidEmail(v), true, v);
  });

  ["", "   ", "plain", "a@b", "a@b.", "a @b.com", "@b.com", "a@@b.com", null, undefined]
    .forEach(function (v) { assert.equal(L.isValidEmail(v), false, String(v)); });
});

test("discountFor prices percentage and fixed codes, capped at the eligible tickets", function () {
  var types = { [GENERAL]: { price: "20.00" }, [VIP]: { price: "50.00" } };
  var sel = selection({ tickets: { [GENERAL]: 2, [VIP]: 1 }, discountCode: " save10 " });
  var base = { code: "SAVE10", status: "active", discount_type: "percentage", value: "10.00",
    max_uses: 0, uses: 0, session_id: null, ticket_type_id: null, start_at: null, end_at: null };

  assert.equal(L.discountFor([base], sel, types).amount, "9.00");
  assert.equal(L.discountFor([Object.assign({}, base, { ticket_type_id: GENERAL })], sel, types).amount, "4.00");
  assert.equal(L.discountFor([Object.assign({}, base, { discount_type: "fixed", value: "500" })], sel, types).amount, "90.00");
  assert.equal(L.discountFor([Object.assign({}, base, { status: "expired" })], sel, types).reason, "inactive");
  assert.equal(L.discountFor([Object.assign({}, base, { max_uses: 3, uses: 3 })], sel, types).reason, "used_up");
  assert.equal(L.discountFor([base], selection({ tickets: {}, discountCode: "SAVE10" }), types).reason, "nothing");
  assert.equal(L.discountFor([base], selection({ tickets: { [GENERAL]: 1 }, discountCode: "NOPE" }), types).reason, "unknown");
});

test("protectionFor is 15% of the tickets after the discount", function () {
  assert.equal(L.protectionFor("40.00", "4.00"), "5.40");
  assert.equal(L.protectionFor("40.00"), "6.00");
});
