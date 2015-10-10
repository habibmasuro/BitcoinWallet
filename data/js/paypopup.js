/**
 * paypopup.js
 * Copyright (c) 2014 Andrew Toth
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the MIT license.
 *
 * Controls paypopup.html, the popup that appears when clicking on bitcoin pay links,
 * or by clicking the context menu
 */

$(document).ready(function () {
    var SATOSHIS = 100000000,
    FEE = SATOSHIS * .0001,
    BTCUnits = 'MONET',
    BTCMultiplier = SATOSHIS,
    clickX,
    clickY,
    port = null;

    // Event is broadcast when context menu is opened on the page
    $(document).on('contextmenu', function (e) {
        // Save the position of the right click to use for positioning the popup
        clickX = e.clientX;
        clickY = e.clientY;
        if (typeof chrome !== 'undefined') {
            // In Chrome we open a port with the background script
            // to tell us when the menu item is clicked
            if (port) {
                port.disconnect();
            }
            port = chrome.runtime.connect();
            port.onMessage.addListener(function(response) {
                var rect = null;
                if (response.address) {
                    // We only have an address in Chrome if it was selected by right clicking,
                    // so we can get the location of the address by finding the selection
                    rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
                }
                showPopup(response.address, null, rect);
            });
        }
    });

    if (typeof chrome === 'undefined') {
        // In Firefox we listen for the pay message to be sent
        self.port.on('pay', function (message) {
            if (message.address) {
                // If we have an address, the position of the address is sent as well
                var rect = {};
                rect.left = message.left;
                rect.right = message.right;
                rect.top = message.top;
                rect.bottom = message.bottom;
                showPopup(message.address, null, rect);
            } else {
                showPopup(null, null, null);
            }
        });
    }

    // Intercept all anchor clicks and determine if they are bitcoin pay links
    $('body').on('click', 'a', function (e) {
        var href = $(this).attr('href');
        // Regex test for bitcoin pay link
        if (/^moneta:[13][1-9A-HJ-NP-Za-km-z]{26,33}/.test(href)) {
            var addresses = href.match(/[13][1-9A-HJ-NP-Za-km-z]{26,33}/);
            var address = null;
            if (addresses) {
                address = addresses[0];
            }
            var amounts = href.match(/amount=\d+\.?\d*/);
            var amount = null;
            if (amounts) {
                amount = Number(amounts[0].substring(7)) * SATOSHIS;
            }
            showPopup(address, amount, this.getBoundingClientRect());
            return false;
        }
        // Return true if not a bitcoin link so click will work normally
        return true;
    });

    function showPopup(address, amount, rect) {
        util.iframe('paypopup.html').then(function (iframe) {

            iframe.style.height = '210px';
            iframe.style.width = '210px';
            var offset = {}
            if (rect) {
                offset.left = Number(rect.left) + Number(window.pageXOffset) + Number(rect.right-rect.left)/2 - 85;
                offset.top = Number(rect.bottom) + Number(window.pageYOffset);
            } else {
                offset.left = Number(clickX) + Number(window.pageXOffset);
                offset.top = Number(clickY) + Number(window.pageYOffset);
            }
            iframe.style.left = offset.left + 'px';
            iframe.style.top = offset.top + 'px';

            var $iframe = $(iframe.contentWindow.document);

            wallet.restoreAddress().then(function () {
                if (wallet.isEncrypted()) {
                    // Only show password field if the wallet is encrypted
                    $iframe.find('#password').parent().show();
                }
            }, function () {
                wallet.generateAddress();
            });

            preferences.getBTCUnits().then(function (units) {
                BTCUnits = units;
                if (units === 'µBTC') {
                    BTCMultiplier = SATOSHIS / 1000000;
                } else if (units === 'mBTC') {
                    BTCMultiplier = SATOSHIS / 1000;
                } else {
                    BTCMultiplier = SATOSHIS;
                }
                $iframe.find('#amount').attr('placeholder', 'Amount (' + BTCUnits + ')').attr('step', 100000 / BTCMultiplier);
            });

            // Check if the address is actually valid
            if (!address || !/^[13][1-9A-HJ-NP-Za-km-z]{26,33}$/.test(String(address))) {
                address = null;
            } else {
                try {
                    new Bitcoin.Address(address);
                } catch (e) {
                    address = null;
                }
            }

            // Hide the address field if we have a valid address,
            // else hide the arrow pointing to an address
            if (address) {
                $iframe.find('#address').val(address).parent().hide();
            } else {
                $iframe.find('.arrow').hide();
            }

            // Hide the amount field if we have a valid amount
            if (amount) {
                $iframe.find('#amount').parent().hide();
                updateButton(amount);
            } else {
                $iframe.find('#amount').on('keyup change', function () {
                    var value = Math.floor(Number($iframe.find('#amount').val() * BTCMultiplier));
                    updateButton(value);
                });
            }

            function updateButton(value) {
                currencyManager.formatAmount(value).then(function (formattedMoney) {
                    var text = 'Send';
                    if (value > 0) {
                        text += ' (' + formattedMoney + ')';
                    }
                    $iframe.find('#button').text(text);
                });
            }

            $iframe.find('#main').fadeIn('fast');

            $iframe.find('#button').click(function () {
                var validAmount = true,
                    validAddress = true,
                    newAmount;
                if (!amount) {
                    newAmount = Math.floor(Number($iframe.find('#amount').val() * BTCMultiplier));
                } else {
                    newAmount = amount;
                }
                var balance = wallet.getBalance();
                if (newAmount <= 0) {
                    validAmount = false;
                } else if (newAmount + FEE > balance) {
                    validAmount = false;
                }

                var newAddress;
                if (!address) {
                    newAddress = $iframe.find('#address').val();
                    if (!/^[13][1-9A-HJ-NP-Za-km-z]{26,33}$/.test(String(newAddress))) {
                        validAddress = false;
                    } else {
                        try {
                            new Bitcoin.Address(newAddress);
                        } catch (e) {
                            validAddress = false;
                        }
                    }
                } else {
                    newAddress = address;
                }

                $iframe.find('#amount').parent().removeClass('has-error');
                $iframe.find('#address').parent().removeClass('has-error');
                $iframe.find('#password').parent().removeClass('has-error');
                if (!validAddress) {
                    $iframe.find('#errorAlert').text('Invalid address').slideDown();
                    $iframe.find('#address').parent().addClass('has-error');
                } else if (!validAmount) {
                    $iframe.find('#errorAlert').text('Insufficient funds').slideDown();
                    $iframe.find('#amount').parent().addClass('has-error');
                } else if (!navigator.onLine) {
                    $iframe.find('#errorAlert').text('Connection offline').slideDown();
                    $iframe.find('#amount').parent().addClass('has-error');
                } else {
                    $(document).off('click.wallet contextmenu.wallet');
                    $iframe.find('#errorAlert').slideUp();
                    $iframe.find('#amount').parent().fadeOut('fast');
                    $iframe.find('#address').parent().fadeOut('fast');
                    $iframe.find('#password').parent().fadeOut('fast');
                    $iframe.find('#button').fadeOut('fast', function () {
                        $iframe.find('#progress').fadeIn('fast', function () {
                            wallet.send(newAddress, newAmount, FEE, $iframe.find('#password').val()).then(function () {
                                $iframe.find('#progress').fadeOut('fast', function () {
                                    $iframe.find('#successAlert').fadeIn('fast').delay(1000).fadeIn('fast', removeFrame);
                                });
                            }, function (e) {
                                $iframe.find('#progress').fadeOut('fast', function () {
                                    if (e.message === 'Incorrect password') {
                                        $iframe.find('#password').parent().addClass('has-error');
                                    } else if (e.message === 'Insufficient funds') {
                                        $iframe.find('#amount').parent().addClass('has-error');
                                    }
                                    $iframe.find('#errorAlert').text(e.message).slideDown();
                                    if (!address) {
                                        $iframe.find('#address').parent().fadeIn();
                                    }
                                    if (!amount) {
                                        $iframe.find('#amount').parent().fadeIn();
                                    }
                                    if (wallet.isEncrypted()) {
                                        $iframe.find('#password').parent().fadeIn();
                                    }
                                    $iframe.find('#button').fadeIn();
                                    $(document).on('click.wallet contextmenu.wallet', removeFrame);
                                });
                            });
                        });
                    });
                }
            });

            $(document).on('click.wallet contextmenu.wallet', removeFrame);

            function removeFrame() {
                $(document).off('click.wallet contextmenu.wallet');
                $(iframe).fadeOut('fast', function () {
                    $(this).remove();
                });
            }
        });
    }


});
