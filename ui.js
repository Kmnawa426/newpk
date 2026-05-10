(function initAppModal() {
  const state = {
    alertQueue: [],
    activeAlert: null,
    activeResolver: null
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return entities[char];
    });
  }

  function ensureModal() {
    let modal = document.getElementById("appModal");
    if (modal) {
      return modal;
    }

    modal = document.createElement("dialog");
    modal.id = "appModal";
    modal.className = "modal-shell";
    modal.innerHTML = `
      <div class="modal-card app-modal-info modal-content" id="appModalCard">
        <span class="modal-badge badge" id="appModalBadge">Notice</span>
        <h3 id="appModalTitle">Notice</h3>
        <p class="modal-message modal-body" id="appModalMessage"></p>
        <ul class="modal-list list-group list-group-flush" id="appModalList" hidden></ul>
        <div class="modal-actions modal-footer">
          <button type="button" class="ghost btn btn-light" id="appModalCancel" hidden>Cancel</button>
          <button type="button" class="primary btn btn-primary" id="appModalConfirm">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener("cancel", (event) => {
      event.preventDefault();
      resolveModal(false);
    });

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        resolveModal(false);
      }
    });

    modal.querySelector("#appModalConfirm").addEventListener("click", () => resolveModal(true));
    modal.querySelector("#appModalCancel").addEventListener("click", () => resolveModal(false));

    return modal;
  }

  function renderModal({ title, message, tone = "info", confirmText = "OK", cancelText = "Cancel", showCancel = false, list = [] }) {
    const modal = ensureModal();
    const card = modal.querySelector("#appModalCard");
    const badge = modal.querySelector("#appModalBadge");
    const titleNode = modal.querySelector("#appModalTitle");
    const messageNode = modal.querySelector("#appModalMessage");
    const listNode = modal.querySelector("#appModalList");
    const cancelBtn = modal.querySelector("#appModalCancel");
    const confirmBtn = modal.querySelector("#appModalConfirm");

    card.className = `modal-card app-modal-${tone} modal-content`;
    badge.className = `modal-badge badge ${tone === "danger" ? "text-bg-danger" : tone === "success" ? "text-bg-success" : "text-bg-info"}`;
    badge.textContent = tone === "danger" ? "Warning" : tone === "success" ? "Success" : "Notice";
    titleNode.textContent = title || "Notice";
    messageNode.textContent = message || "";
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    cancelBtn.hidden = !showCancel;

    if (list.length) {
      listNode.hidden = false;
      listNode.innerHTML = list.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    } else {
      listNode.hidden = true;
      listNode.innerHTML = "";
    }

    if (!modal.open) {
      modal.showModal();
    }
  }

  function processAlertQueue() {
    if (state.activeAlert || !state.alertQueue.length) {
      return;
    }

    state.activeAlert = state.alertQueue.shift();
    renderModal({
      title: state.activeAlert.title || "Notice",
      message: state.activeAlert.message,
      tone: state.activeAlert.tone || "info",
      confirmText: state.activeAlert.confirmText || "OK",
      showCancel: false
    });
  }

  function resolveModal(result) {
    const modal = ensureModal();
    if (state.activeResolver) {
      const resolver = state.activeResolver;
      state.activeResolver = null;
      modal.close();
      resolver(result);
      return;
    }

    if (state.activeAlert) {
      const activeAlert = state.activeAlert;
      state.activeAlert = null;
      modal.close();
      if (typeof activeAlert.resolve === "function") {
        activeAlert.resolve();
      }
      processAlertQueue();
    }
  }

  window.showAppAlert = function showAppAlert(message, options = {}) {
    return new Promise((resolve) => {
      state.alertQueue.push({
        message: String(message ?? ""),
        title: options.title,
        tone: options.tone,
        confirmText: options.confirmText,
        resolve
      });
      processAlertQueue();
    });
  };

  window.showConfirmDialog = function showConfirmDialog(message, options = {}) {
    return new Promise((resolve) => {
      if (state.activeResolver || state.activeAlert) {
        state.alertQueue.push({
          message: String(message ?? ""),
          title: options.title || "Confirm Action",
          tone: options.tone || "danger",
          confirmText: options.confirmText || "Confirm",
          resolve: () => {
            window.showConfirmDialog(message, options).then(resolve);
          }
        });
        return;
      }

      state.activeResolver = resolve;
      renderModal({
        title: options.title || "Confirm Action",
        message: String(message ?? ""),
        tone: options.tone || "danger",
        confirmText: options.confirmText || "Confirm",
        cancelText: options.cancelText || "Cancel",
        showCancel: true,
        list: options.list || []
      });
    });
  };

  window.alert = function appAlert(message) {
    window.showAppAlert(message);
  };

  const busyActions = new Set();

  window.runLockedAction = async function runLockedAction(key, task, button) {
    const actionKey = String(key || "action");
    if (busyActions.has(actionKey)) {
      return null;
    }

    busyActions.add(actionKey);
    const targetButton = button instanceof HTMLElement ? button : null;
    const previousText = targetButton?.textContent;

    if (targetButton) {
      targetButton.disabled = true;
      targetButton.classList.add("is-busy");
      if (targetButton.dataset.busyText) {
        targetButton.textContent = targetButton.dataset.busyText;
      }
    }

    try {
      return await task();
    } finally {
      busyActions.delete(actionKey);
      if (targetButton) {
        targetButton.disabled = false;
        targetButton.classList.remove("is-busy");
        if (targetButton.dataset.busyText && previousText !== undefined) {
          targetButton.textContent = previousText;
        }
      }
    }
  };
})();
