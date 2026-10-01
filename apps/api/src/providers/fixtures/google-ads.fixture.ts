export const googleAccessibleCustomersFixture = {
  resourceNames: ["customers/1234567890"],
};

export const googleCustomerHierarchyFixture = [
  {
    results: [
      {
        customer: {
          id: "1234567890",
          descriptiveName: "HolyMedia Test Customer",
          currencyCode: "USD",
          timeZone: "Asia/Almaty",
          status: "ENABLED",
        },
      },
    ],
  },
];

export const googleManagerClientsFixture = [
  {
    results: [
      {
        customerClient: {
          id: "2345678901",
          descriptiveName: "Client Account",
          manager: false,
          level: 1,
          status: "ENABLED",
          currencyCode: "KZT",
          timeZone: "Asia/Almaty",
        },
      },
    ],
  },
];

export const googleCampaignFixture = [
  {
    results: [
      {
        campaign: {
          id: "1001",
          name: "Search campaign",
          status: "ENABLED",
          advertisingChannelType: "SEARCH",
        },
        campaignBudget: {
          amountMicros: "2500000",
          resourceName: "customers/1234567890/campaignBudgets/500",
          explicitlyShared: false,
          period: "DAILY",
        },
        metrics: {
          costMicros: "1250000",
          impressions: "1000",
          clicks: "50",
          averageCpc: "25000",
          conversions: 2,
          conversionsValue: 300,
          costPerConversion: "625000",
        },
      },
    ],
  },
];
