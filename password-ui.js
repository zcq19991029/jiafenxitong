/* 修改密码对话框（Supabase）：先用原密码重新登录一次，确认是本人才允许改。 */
(function () {
  'use strict';
  var cloud = window.JFDT_CLOUD, byId = function (id) { return document.getElementById(id); };
  if (!cloud) return;
  var dialog = byId('dlgPassword');
  if (!dialog) return;

  function clear() {
    ['oldPassword', 'newPassword', 'newPasswordConfirm'].forEach(function (id) { var el = byId(id); if (el) el.value = ''; });
  }
  function say(text) {
    var box = byId('passwordMsg');
    if (!box) return;
    box.textContent = text || '';
    box.hidden = !text;
  }

  var trigger = byId('btnChangePassword');
  if (trigger) trigger.onclick = function () {
    var me = byId('dlgMe');
    if (me && me.open) me.close('cancel');
    clear(); say('');
    dialog.showModal();
  };
  var closeBtn = byId('btnPasswordClose');
  if (closeBtn) closeBtn.onclick = function () { dialog.close(); };
  dialog.addEventListener('close', clear);

  byId('passwordForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var profile = cloud.profile && cloud.profile();
    if (profile && profile.anonymous) {
      say('当前是访客身份，没有密码。注册一个邮箱账号后就能设置密码。');
      return;
    }
    var oldPassword = byId('oldPassword').value;
    var password = byId('newPassword').value;
    if (password.length < 6 || password.length > 128) { say('新密码需为 6–128 位。'); return; }
    if (password !== byId('newPasswordConfirm').value) { say('两次输入的新密码不一致。'); return; }
    if (password === oldPassword) { say('新密码不能和原密码相同。'); return; }
    if (!oldPassword) { say('请输入原密码。'); return; }

    var submit = byId('btnPasswordSave');
    submit.disabled = true;
    say('');
    var ready = cloud.flush ? cloud.flush().catch(function () {}) : Promise.resolve();
    ready.then(function () { return cloud.verifyPassword(oldPassword); })
      .then(function () { return cloud.changePassword(oldPassword, password); })
      .then(function () {
        dialog.close(); clear();
        alert('密码已修改。下次登录请使用新密码。');
      })
      .catch(function (error) { say(error && error.message ? error.message : String(error)); })
      .finally(function () { submit.disabled = false; });
  });
})();
