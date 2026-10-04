// فاتورة الرويال باس المميز بنجوم تيليجرام (XTR) — تُستعمل من التطبيق ومن البوت.

export function passPrice(env) {
  return Math.max(1, Math.round(Number(env.PASS_PRICE_STARS) || 99));
}

/** فاتورة الرويال باس المميز بالنجوم (XTR) */
export function passInvoice(env, uid, season) {
  return {
    title: `رويال باس مميز — الموسم ${season}`,
    description: 'يفتح 100 لفل بالرويال باس بدل 50، وجوائز أقوى: شخصيات وإكسسوارات ومسارح حصرية ومايكات أكثر. للموسم الحالي.',
    payload: `pass:${uid}:${season}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: 'رويال باس مميز', amount: passPrice(env) }],
  };
}
