export const launchFilmStory = {
  persona: {
    name: 'Sam',
    role: 'solo indie hacker',
    project: 'Supafan',
    currentWork: 'checkout flow',
  },
  threads: {
    checkoutImplementation: {
      id: 'thread-checkout-flow-implementation',
      title: 'Checkout flow implementation',
      shortCode: 'AB-42',
    },
    stripePaymentIntegration: {
      id: 'thread-stripe-payment-integration',
      title: 'Stripe payment integration',
      shortCode: 'AB-47',
    },
    deployChecklist: {
      id: 'thread-deploy-checklist',
      title: 'Deploy checklist',
      shortCode: 'AB-53',
    },
    addDiscountCodeSupport: {
      id: 'thread-add-discount-code-support',
      title: 'Add discount code support',
    },
    receiptEmailTemplates: {
      id: 'thread-receipt-email-templates',
      title: 'Receipt email templates',
    },
  },
  branch: 'sam/checkout-flow',
  baseBranch: 'main',
  projectPath: '~/Supafan',
  repo: 'supafan/supafan',
  author: 'sam',
  command: '/supafan deploy-checkout',
  flow: {
    id: 'flow-deploy-checkout',
    title: 'Deploy Checkout',
    switchLabel: 'is /supafan deploy-checkout',
    actionLabels: {
      migrations: 'Run database migrations',
      notify: 'Notify #releases channel',
    },
  },
  calendar: {
    monthLabel: 'June 2026',
    dayLabel: 'Saturday, June 27, 2026',
    dayBreadcrumb: 'Jun 27, 2026',
    launchEvent: {
      title: 'Launch Supafan checkout',
      start: '10:00 AM',
      end: '11:00 AM',
      timeLabel: '10:00 AM – 11:00 AM',
    },
    seededEvents: {
      betaFreeze: {title: 'Beta freeze', day: 22},
      stripeReview: {title: 'Stripe webhook review', day: 25, time: '2:00 PM'},
      deployChecklist: {title: 'Deploy checklist', day: 18, time: '10:30 AM'},
    },
  },
} as const;
