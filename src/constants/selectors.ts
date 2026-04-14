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
    alignCenter:
      'button.se-toolbar-option-align-center-button[data-value="center"], button[data-value="center"], button[aria-label="가운데 정렬"], button[title="가운데 정렬"]',
    alignLeft:
      'button.se-toolbar-option-align-left-button[data-value="left"], button[data-value="left"], button[aria-label="왼쪽 정렬"], button[title="왼쪽 정렬"]',
    bold: 'button[data-group="propertyToolbar"][data-name="bold"], button[data-group="contentsToolbar"][data-name="bold"]',
    fontSizeDropdown:
      'button[data-group="propertyToolbar"][data-name="font-size"], button[data-group="contentsToolbar"][data-name="font-size"]',
    fontSize24:
      'button[data-group="propertyToolbar"][data-name="font-size"][data-role="option"][data-value="fs24"], button[data-group="contentsToolbar"][data-name="font-size"][data-role="option"][data-value="fs24"]',
    fontSize15:
      'button[data-group="propertyToolbar"][data-name="font-size"][data-role="option"][data-value="fs15"], button[data-group="contentsToolbar"][data-name="font-size"][data-role="option"][data-value="fs15"]',
    textLinkBtn:
      'button[data-group="propertyToolbar"][data-name="text-link"], button[data-group="contentsToolbar"][data-name="text-link"], button[data-name="text-link"]',
    linkInput: 'input.se-custom-layer-link-input',
    linkApplyBtn: 'button.se-custom-layer-link-apply-button',
    fontColor:
      'button[data-name="font-color"][data-group="propertyToolbar"], button[data-name="font-color"][data-group="contentsToolbar"]',
    fontColorWhite: 'button.se-color-palette[title="#ffffff"]',
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
