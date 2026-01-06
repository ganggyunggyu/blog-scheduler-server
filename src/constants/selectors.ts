export const SELECTORS = {
  login: {
    id: '#id',
    pw: '#pw',
    btn: '.btn_login',
    captcha: '#captcha',
  },

  editor: {
    title: '.se-title-input',
    content: '.se-text-paragraph',
    imageUpload: 'input[type="file"]',
  },

  publish: {
    btn: "button.publish_btn__m9KHH, button[data-click-area='tpb.publish']",
    confirm: "button.confirm_btn__WEaBq, button[data-testid='seOnePublishBtn']",
    publicRadio: 'input#open_public',
    privateRadio: 'input#open_private',
    scheduleRadio: "label[for='radio_time2'], label.radio_label__mB6ia",
    hourSelect: 'select.hour_option__J_heO',
    minuteSelect: 'select.minute_option__Vb3xB',
    dateInput: "input.input_date__QmA0s",
    datepickerNextMonth: 'button.ui-datepicker-next',
    datepickerPrevMonth: 'button.ui-datepicker-prev',
    datepickerYear: 'span.ui-datepicker-year',
    datepickerMonth: 'span.ui-datepicker-month',
  },

  popup: {
    cancel: 'button.se-popup-button-cancel',
    helpClose: 'button.se-help-panel-close-button',
  },
};
