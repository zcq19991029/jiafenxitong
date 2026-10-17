(function () {
  'use strict';
  var cloud = window.JFDT_CLOUD, $ = function (id) { return document.getElementById(id); };
  function showGate(which, message) {
    document.body.classList.add('gated'); $('gate').hidden = false;
    ['Login','Invite','Offline','Reset'].forEach(function (name) { $('gate'+name).hidden = name !== which; });
    $('gateMsg').textContent = message || ''; $('gateMsg').hidden = !message;
  }
  function clearPasswords() {
    ['oldPassword','newPassword','newPasswordConfirm','resetPassword','resetConfirm'].forEach(function (id) { $(id).value = ''; });
  }
  $('btnForgotPassword').onclick = function () { showGate('Reset'); $('resetUsername').value = $('loginUsername').value; };
  $('btnResetBack').onclick = function () { clearPasswords(); $('resetCode').value = ''; showGate('Login'); };
  $('btnResetPassword').onclick = function () {
    var password = $('resetPassword').value;
    if (password.length < 6 || password.length > 128 || password !== $('resetConfirm').value) { showGate('Reset','密码需为 6–128 位，且两次输入须一致。'); return; }
    $('btnResetPassword').disabled = true;
    cloud.resetPassword($('resetUsername').value.trim(), $('resetCode').value.trim(), password).then(function () {
      clearPasswords(); $('resetCode').value = ''; $('loginUsername').value = $('resetUsername').value;
      showGate('Login','密码已重置，请用新密码登录。');
    }).catch(function (error) { showGate('Reset',error.message); }).finally(function () { $('btnResetPassword').disabled = false; });
  };
  var dialog = $('dlgPassword');
  $('btnChangePassword').onclick = function () { $('dlgMe').close('cancel'); clearPasswords(); $('passwordMsg').hidden = true; dialog.showModal(); };
  $('btnPasswordClose').onclick = function () { dialog.close(); };
  dialog.addEventListener('close', clearPasswords);
  $('passwordForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var password = $('newPassword').value;
    if (password.length < 6 || password.length > 128 || password !== $('newPasswordConfirm').value) {
      $('passwordMsg').textContent = '密码需为 6–128 位，且两次输入须一致。'; $('passwordMsg').hidden = false; return;
    }
    $('btnPasswordSave').disabled = true;
    cloud.flush().then(function () { return cloud.changePassword($('oldPassword').value, password); }).then(function () {
      dialog.close(); clearPasswords();
    }).catch(function (error) { $('passwordMsg').textContent = error.message; $('passwordMsg').hidden = false; })
      .finally(function () { $('btnPasswordSave').disabled = false; });
  });
  $('btnIssueReset').onclick = function () {
    var username = $('adminResetUsername').value.trim();
    if (!username) { $('adminResetResult').textContent = '请填写需要重置的教师账号。'; return; }
    $('btnIssueReset').disabled = true; $('adminResetResult').textContent = '正在生成…';
    cloud.admin.resetPassword(username).then(function (result) {
      $('adminResetResult').textContent = '账号 '+username+' 的一次性重置码：'+result.code+'（30 分钟有效，请仅交给核验后的教师）';
    }).catch(function (error) { $('adminResetResult').textContent = error.message; })
      .finally(function () { $('btnIssueReset').disabled = false; });
  };
})();
