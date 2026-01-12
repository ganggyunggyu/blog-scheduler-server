export const SELECTORS = {
  login: {
    id: '#id',
    pw: '#pw',
    btn: ".btn_login, #log\\.login, button[type='submit']",
    captcha: '#captcha',
  },

  editor: {
    content: 'div.se-component-content, div[contenteditable="true"], p.se-text-paragraph',
    imageBtn: 'button[data-name="image"], button.se-toolbar-button-image',
    alignDropdown: 'button[data-name="align-drop-down-with-justify"], button.se-align-left-toolbar-button',
    alignCenter: 'button.se-toolbar-option-align-center-button[data-value="center"]',
    alignLeft: 'button.se-toolbar-option-align-left-button[data-value="left"]',
  },

  publish: {
    btn: "button.publish_btn__m9KHH, button[data-click-area='tpb.publish']",
    confirm: "button.confirm_btn__WEaBq, button[data-testid='seOnePublishBtn']",
    publicRadio: "label[for='open_public']",
    privateRadio: "label[for='open_private']",
    scheduleRadio: "label[for='radio_time2'], label.radio_label__mB6ia",
    timeSetting: "div.time_setting__v6YRU, div[class*='time_setting']",
    hourSelect: 'select.hour_option__J_heO',
    minuteSelect: 'select.minute_option__Vb3xB',
    dateInput: 'input.input_date__QmA0s',
    datepickerNextMonth: 'button.ui-datepicker-next',
    datepickerPrevMonth: 'button.ui-datepicker-prev',
    datepickerYear: 'span.ui-datepicker-year',
    datepickerMonth: 'span.ui-datepicker-month',
    datepickerHeader: '.ui-datepicker-header',
    tagInput: 'input#tag-input, input.tag_input__rvUB5',
    categoryBtn: "button[data-click-area='tpb*i.category']",
    categoryList: 'div.option_list_layer__YX1Tq ul.list__RcvVA',
    categoryItem: 'span.text__sraQE',
  },

  popup: {
    cancel: 'button.se-popup-button-cancel',
    helpClose: 'button.se-help-panel-close-button',
  },
};
