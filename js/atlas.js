/*
 * Atlas runtime — managed by Atlas. Do not edit: this file is rewritten
 * whenever the site is provisioned.
 *
 * Two jobs: report a pageview to the workspace's analytics, and deliver
 * contact-form submissions to the leads inbox without leaving the page.
 */
(function () {
  var WEBSITE_ID = "d3ce8bcf-b110-48a7-a5c3-d0e197f918b4";
  var ANALYTICS_ENDPOINT = "https://atlas.quikquoteai.com/api/track";

  function configured(value) {
    return typeof value === "string" && value.indexOf("__") !== 0 && value.length > 0;
  }

  function campaignTag(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || "";
    } catch (err) {
      return "";
    }
  }

  function trackPageview() {
    if (!configured(WEBSITE_ID) || !configured(ANALYTICS_ENDPOINT)) return;
    try {
      fetch(ANALYTICS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          website_id: WEBSITE_ID,
          path: window.location.pathname || "/",
          referrer: document.referrer || "",
          // Which ad or campaign sent them. The same tags the contact form
          // already forwards, kept for the visit as well as for the lead.
          utm_source: campaignTag("utm_source"),
          utm_medium: campaignTag("utm_medium"),
          utm_campaign: campaignTag("utm_campaign")
        })
      }).catch(function () {});
    } catch (err) {
      // analytics must never break the site
    }
  }

  function statusNode(form) {
    var existing = form.querySelector("[data-atlas-status]");
    if (existing) return existing;

    // A form designed with its own status line already has a place for this
    // message; appending a second one would show the site's empty box above
    // our text.
    var own = form.querySelector('[role="status"]');
    if (own) {
      own.setAttribute("data-atlas-status", "");
      return own;
    }

    var node = document.createElement("p");
    node.setAttribute("data-atlas-status", "");
    node.setAttribute("role", "status");
    node.style.margin = "12px 0 0";
    form.appendChild(node);
    return node;
  }

  function submitButtons(form) {
    return form.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]');
  }

  function handleSubmit(event) {
    var form = event.currentTarget;
    var endpoint = form.getAttribute("action") || "";
    if (!configured(endpoint)) return;

    event.preventDefault();

    var status = statusNode(form);
    var buttons = submitButtons(form);
    var labels = [];
    for (var i = 0; i < buttons.length; i++) {
      labels.push(buttons[i].textContent);
      buttons[i].disabled = true;
    }

    status.style.color = "inherit";
    status.textContent = "Sending…";

    fetch(endpoint, { method: "POST", body: new FormData(form) })
      .then(function (response) {
        if (!response.ok) throw new Error("failed");
        form.reset();
        status.textContent = "Thanks — we got your message and will be in touch shortly.";
      })
      .catch(function () {
        status.style.color = "#b91c1c";
        status.textContent = "Something went wrong. Please try again, or call us instead.";
      })
      .then(function () {
        for (var j = 0; j < buttons.length; j++) {
          buttons[j].disabled = false;
          if (labels[j] != null && buttons[j].textContent !== labels[j]) {
            buttons[j].textContent = labels[j];
          }
        }
      });
  }

  function wireForms() {
    var forms = document.querySelectorAll('form[action*="/api/leads"]');
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].getAttribute("data-atlas-wired")) continue;
      forms[i].setAttribute("data-atlas-wired", "1");
      forms[i].addEventListener("submit", handleSubmit);
    }
  }

  function start() {
    wireForms();
    trackPageview();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
