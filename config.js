// Transportation Manager settings.
window.TM_CONFIG = {
  // Unpaid Time Off — the same Apps Script web app the Time Off app and the
  // Driver Toolkit use. Managers sign in with their own Time Off PIN.
  UTO_API_URL: 'https://script.google.com/macros/s/AKfycbxz1Jp44C5vJnn1EPSkgaxwf3Vn96l_ctgjTXNgYKFj4jTU89nuJMZ4RuWtxt7SWKa5Kg/exec',

  // PTO approvals stay in the existing PTO system; this button opens it.
  PTO_MANAGER_URL: 'https://script.google.com/a/macros/logisticswarehouse.net/s/AKfycbwXblseav0VCgynTXxL6BYTLniZ4xJAiYholbDgnFPXBqL46_sxP1Rc49MWMga52QsV/exec?page=manager'
};

// Trailers — the Trailer Defect Inspection web app (Code.gs + Api.gs +
// ShopApi.gs). Managers sign in with the Dashboard PIN from its Config tab.
window.TS_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyTZ4y30FAUEqoSBZR2luzCrwWWGtitmrDEAmILm1NTywV78yveXPxYSI5tBLI6QyFO/exec',
  MANAGERS: [
    { name: 'Chris Morland', phone: '479-652-1662' },
    { name: 'Derek Dixon',   phone: '479-651-9227' }
  ],
  WX_LAT: 35.3859,
  WX_LNG: -94.3985
};
