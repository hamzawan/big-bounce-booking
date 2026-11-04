/*
  Booking page logic with no DOM in it: request bodies, change detection,
  the price breakdown and error messages. Used by booking.html, and by
  tests/booking_logic.test.js under `node --test`.

  Mirrors the backend contract (app/modules/bookings/schemas.py):

    POST /api/v1/bookings/create/
    PUT  /api/v1/bookings/{id}/update/   only what is sent is changed
    GET  /api/v1/bookings/{id}

  Every amount shown as final comes from the booking the backend returns.
  The only sums done here are the estimate shown before a booking exists.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BookingLogic = factory();
  }
})(this, function () {
  "use strict";

  // The backend's own limits, so the page refuses what it would refuse.
  var MAX_BOOKING_ITEMS = 20;
  var MAX_BOOKING_ADD_ONS = 20;
  var MAX_ADD_ON_QUANTITY = 100;
  var ADD_ON_DROPDOWN_MAX = 10;

  // A whole number in [0, max]; anything else becomes 0.
  function clampQuantity(value, max) {
    var n = Math.floor(Number(value));

    if (!isFinite(n) || n < 0) return 0;
    if (typeof max === "number" && n > max) return max;

    return n;
  }

  // { id: quantity } -> [{ <key>: id, quantity }], zero quantities dropped.
  function lines(quantities, key) {
    return Object.keys(quantities || {})
      .filter(function (id) { return quantities[id] > 0; })
      .map(function (id) {
        var line = {};
        line[key] = id;
        line.quantity = quantities[id];
        return line;
      });
  }

  function ticketItems(tickets) { return lines(tickets, "ticket_type_id"); }
  function addOnItems(addOns)   { return lines(addOns, "add_on_id"); }

  function sameQuantities(a, b) {
    var left = lines(a, "id");
    var right = lines(b, "id");

    if (left.length !== right.length) return false;

    return left.every(function (line) {
      return (b || {})[line.id] === line.quantity;
    });
  }

  function normaliseCode(code) {
    return typeof code === "string" ? code.trim().toUpperCase() : code;
  }

  /*
    A selection is what the customer has chosen:

      { sessionId, tickets: {id: qty}, addOns: {id: qty}, email,
        ticketProtection, discountCode }

    discountCode is "" for none, or a code. On a selection read back from
    a booking it is undefined when the booking carries a discount: the
    response gives the discount's id, never its code.
  */
  function selectionFromBooking(booking) {
    var tickets = {};
    var addOns = {};

    (booking.items || []).forEach(function (item) {
      tickets[item.ticket_type_id] = item.quantity;
    });

    (booking.add_ons || []).forEach(function (addOn) {
      addOns[addOn.add_on_id] = addOn.quantity;
    });

    return {
      sessionId: booking.session_id || null,
      tickets: tickets,
      addOns: addOns,
      email: booking.customer_email || "",
      name: booking.customer_name || "",
      phone: booking.customer_phone || "",
      ticketProtection: !!booking.ticket_protection,
      discountCode: booking.discount_id ? undefined : ""
    };
  }

  function createPayload(selection) {
    var body = {
      items: ticketItems(selection.tickets),
      payment_provider: "stripe",
      ticket_protection: !!selection.ticketProtection,
      add_ons: addOnItems(selection.addOns)
    };

    // Only a cross-check on the backend; left out for an event without
    // sessions.
    if (selection.sessionId) body.session_id = selection.sessionId;

    var email = (selection.email || "").trim();
    if (email) body.customer_email = email;

    var name = (selection.name || "").trim();
    if (name) body.customer_name = name;

    var phone = (selection.phone || "").trim();
    if (phone) body.customer_phone = phone;

    var code = (selection.discountCode || "").trim();
    if (code) body.discount_code = code;

    return body;
  }

  // Only what differs from the saved booking, or null when nothing does.
  function updatePayload(saved, selection) {
    var body = {};

    if (
      !sameQuantities(saved.tickets, selection.tickets) ||
      (saved.sessionId || null) !== (selection.sessionId || null)
    ) {
      body.items = ticketItems(selection.tickets);
      if (selection.sessionId) body.session_id = selection.sessionId;
    }

    // Sent whole, as it replaces the booking's add-ons; [] only when the
    // customer took off every one.
    if (!sameQuantities(saved.addOns, selection.addOns)) {
      body.add_ons = addOnItems(selection.addOns);
    }

    if (!!saved.ticketProtection !== !!selection.ticketProtection) {
      body.ticket_protection = !!selection.ticketProtection;
    }

    if (normaliseCode(saved.discountCode) !== normaliseCode(selection.discountCode)) {
      var code = (selection.discountCode || "").trim();

      // null removes the booking's code.
      body.discount_code = code || null;
    }

    // An email cannot be taken off a booking, only set or replaced.
    var email = (selection.email || "").trim();
    if (email && email !== (saved.email || "")) body.customer_email = email;

    // Likewise the name and phone number: set or replaced, never removed.
    var name = (selection.name || "").trim();
    if (name && name !== (saved.name || "")) body.customer_name = name;

    var phone = (selection.phone || "").trim();
    if (phone && phone !== (saved.phone || "")) body.customer_phone = phone;

    return Object.keys(body).length ? body : null;
  }

  // Problems the backend would refuse anyway, caught before a request.
  // limits is { ticket_type_id: { name, max } }, max counting what the
  // booking itself already holds.
  function validate(selection, limits) {
    var errors = [];
    var items = ticketItems(selection.tickets);

    if (!items.length) errors.push("Choose at least one ticket.");
    if (items.length > MAX_BOOKING_ITEMS) {
      errors.push("Choose at most " + MAX_BOOKING_ITEMS + " ticket types.");
    }

    items.forEach(function (item) {
      var limit = (limits || {})[item.ticket_type_id];

      if (limit && item.quantity > limit.max) {
        errors.push("Only " + limit.max + " " + limit.name +
          " tickets are left.");
      }
    });

    var addOns = addOnItems(selection.addOns);

    if (addOns.length > MAX_BOOKING_ADD_ONS) {
      errors.push("Choose at most " + MAX_BOOKING_ADD_ONS + " add-ons.");
    }

    if (addOns.some(function (a) { return a.quantity > MAX_ADD_ON_QUANTITY; })) {
      errors.push("An add-on can be booked at most " + MAX_ADD_ON_QUANTITY +
        " times.");
    }

    var email = (selection.email || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("Enter a valid email address.");
    }

    return errors;
  }

  // Letters, one @ and a dotted domain, no spaces. The backend has the
  // last word; this only keeps an obvious typo from being sent.
  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());
  }

  // 7 to 15 digits, with an optional leading + and the usual separators;
  // at most 20 characters, which is all the backend stores.
  function isValidPhone(value) {
    var v = String(value || "").trim();
    var digits = v.replace(/\D/g, "");

    return v.length <= 20 && /^\+?[0-9\s().-]+$/.test(v) &&
      digits.length >= 7 && digits.length <= 15;
  }

  function isValidName(value) {
    var v = String(value || "").trim();

    return v.length >= 2 && v.length <= 200;
  }

  function toCents(amount) {
    return Math.round(Number(amount) * 100);
  }

  function fromCents(cents) {
    return (cents / 100).toFixed(2);
  }

  /*
    The discount a typed code would give, from the event's discount list.
    A preview only: the backend prices the booking. Returns
    { amount: "4.00", discount } or { amount: "0.00", reason } where reason
    is "unknown" (no such code), "inactive", "used_up", "other_session",
    "no_tickets" or "nothing" (no eligible tickets chosen).
    A fixed discount is taken once off the eligible tickets, never below 0.
  */
  function discountFor(discounts, selection, ticketTypes, now) {
    var code = normaliseCode(selection.discountCode);
    var none = function (reason) { return { amount: "0.00", reason: reason }; };

    if (!code) return none("unknown");

    var d = (discounts || []).filter(function (x) {
      return normaliseCode(x.code) === code;
    })[0];

    if (!d) return none("unknown");

    var t = (now || new Date()).getTime();
    if (d.status !== "active" ||
        (d.start_at && new Date(d.start_at).getTime() > t) ||
        (d.end_at && new Date(d.end_at).getTime() < t)) return none("inactive");
    if (d.max_uses > 0 && d.uses >= d.max_uses) return none("used_up");
    if (d.session_id && d.session_id !== selection.sessionId) return none("other_session");

    var eligible = Object.keys(selection.tickets || {}).reduce(function (total, id) {
      var type = (ticketTypes || {})[id];
      if (!type || (d.ticket_type_id && d.ticket_type_id !== id)) return total;
      return total + toCents(type.price) * selection.tickets[id];
    }, 0);

    if (eligible <= 0) return none("nothing");

    var cents = d.discount_type === "percentage"
      ? Math.round(eligible * Number(d.value) / 100)
      : toCents(d.value);

    return { amount: fromCents(Math.min(cents, eligible)), discount: d };
  }

  // Before a booking exists: tickets and add-ons at their listed prices.
  // Discount and Ticketing Protection are only ever the backend's.
  function estimate(selection, ticketTypes, addOnCatalog) {
    function sum(quantities, catalog) {
      return Object.keys(quantities || {}).reduce(function (total, id) {
        var entry = (catalog || {})[id];
        return entry ? total + toCents(entry.price) * quantities[id] : total;
      }, 0);
    }

    var tickets = sum(selection.tickets, ticketTypes);
    var addOns = sum(selection.addOns, addOnCatalog);

    return {
      ticket_subtotal: fromCents(tickets),
      add_ons_subtotal: fromCents(addOns),
      total: fromCents(tickets + addOns)
    };
  }

  // The backend's own figures, read straight off the booking.
  function breakdown(booking) {
    return {
      ticket_subtotal: String(booking.ticket_subtotal),
      discount_amount: String(booking.discount_amount),
      has_discount: toCents(booking.discount_amount) > 0 || !!booking.discount_id,
      ticket_protection: !!booking.ticket_protection,
      protection_amount: String(booking.protection_amount),
      add_ons_subtotal: String(booking.add_ons_subtotal),
      total_amount: String(booking.total_amount)
    };
  }

  // Nothing to pay, e.g. a 100% code on every ticket: confirmed by the
  // backend without going to Stripe.
  function isFree(booking) {
    return !!booking && toCents(booking.total_amount) === 0;
  }

  function detailOf(body) {
    var detail = body && body.detail;

    // FastAPI validation errors are a list.
    if (Array.isArray(detail)) {
      return detail.map(function (e) {
        var field = (e.loc || []).slice(-1)[0];
        return (field ? field + ": " : "") + e.msg;
      }).join("; ");
    }

    return typeof detail === "string" ? detail : "";
  }

  /*
    What a refused create or update means for the page:

      field  where to show it: discount, addons, tickets or general
      kind   what the page must do next:
               retry     fix the selection and save again
               expired   the hold is gone; start a new booking
               locked    the booking is no longer pending
               paying    a charge is under way; go to the payment page
               missing   the booking does not exist
  */
  function describeError(status, body) {
    var detail = detailOf(body);

    // The second one is the free-booking confirmation's.
    if (detail === "This booking's hold has expired." || detail === "hold_expired") {
      return { field: "general", kind: "expired",
        message: "Your reservation expired. Please start a new booking." };
    }

    if (detail === "Only a pending booking can be updated.") {
      return { field: "general", kind: "locked",
        message: "This booking can no longer be changed." };
    }

    if (detail.indexOf("payment in progress") !== -1) {
      return { field: "general", kind: "paying",
        message: "A payment for this booking is already being processed, " +
          "so it cannot be changed now." };
    }

    if (status === 404 && detail === "Booking not found.") {
      return { field: "general", kind: "missing",
        message: "We could not find this booking. Please start a new one." };
    }

    if (detail.indexOf("Discount code") === 0) {
      return { field: "discount", kind: "retry", message: detail };
    }

    if (detail === "Add-on not found." || detail === "Add-on is not available.") {
      return { field: "addons", kind: "retry",
        message: "One of the add-ons you chose is no longer available. " +
          "Remove it and try again." };
    }

    if (detail === "Not enough tickets available.") {
      return { field: "tickets", kind: "retry",
        message: "Not enough tickets are left for your selection." };
    }

    if (status >= 500 || !status) {
      return { field: "general", kind: "retry",
        message: "Something went wrong on our side. Your changes were not " +
          "saved. Please try again." };
    }

    return { field: "general", kind: "retry",
      message: detail || "Your changes could not be saved (HTTP " + status + ")." };
  }

  return {
    MAX_BOOKING_ITEMS: MAX_BOOKING_ITEMS,
    MAX_BOOKING_ADD_ONS: MAX_BOOKING_ADD_ONS,
    MAX_ADD_ON_QUANTITY: MAX_ADD_ON_QUANTITY,
    ADD_ON_DROPDOWN_MAX: ADD_ON_DROPDOWN_MAX,
    isValidEmail: isValidEmail,
    isValidPhone: isValidPhone,
    isValidName: isValidName,
    clampQuantity: clampQuantity,
    ticketItems: ticketItems,
    addOnItems: addOnItems,
    selectionFromBooking: selectionFromBooking,
    createPayload: createPayload,
    updatePayload: updatePayload,
    validate: validate,
    estimate: estimate,
    discountFor: discountFor,
    breakdown: breakdown,
    isFree: isFree,
    detailOf: detailOf,
    describeError: describeError
  };
});
