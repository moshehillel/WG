import { describe, expect, it } from 'vitest';
import {
  buildUpdateAcceptedServicesBody,
  mergeAcceptedServices,
  parseAcceptedServiceDisciplines,
  parseDemoEchoFromXml,
} from './update-accepted-services.js';

describe('mergeAcceptedServices', () => {
  it('returns missing disciplines case-insensitively', () => {
    expect(mergeAcceptedServices(['PCA', 'RN', 'PA'], ['ot', 'RN'])).toEqual({
      merged: ['PCA', 'RN', 'PA', 'ot'],
      missing: ['ot'],
    });
  });

  it('no-ops when already present', () => {
    expect(mergeAcceptedServices(['OT', 'PT'], ['OT'])).toEqual({
      merged: ['OT', 'PT'],
      missing: [],
    });
  });
});

describe('parseAcceptedServiceDisciplines', () => {
  it('reads Discipline children under AcceptedServices', () => {
    const xml = `<Patient><AcceptedServices><Discipline>PCA</Discipline><Discipline>RN</Discipline></AcceptedServices></Patient>`;
    expect(parseAcceptedServiceDisciplines(xml)).toEqual(['PCA', 'RN']);
  });
});

describe('buildUpdateAcceptedServicesBody', () => {
  it('emits AddressID, AcceptedServices Disciplines, and nillable Zip4', () => {
    const xml = buildUpdateAcceptedServicesBody({
      patientId: 958000,
      firstName: 'ALFREDA',
      lastName: 'JONES',
      birthDate: '1960-03-25',
      gender: 'Female',
      coordinatorId1: '25164',
      priorityCode: '2',
      serviceRequestStartDate: '2012-03-09',
      nurseId: '4652126',
      medicaidNumber: 'ZW20696J',
      sourceOfAdmission: '9300',
      teamId: '2036',
      branchId: '10073742',
      locationId: '12284',
      addressId: '2966779',
      address1: '1036 INTERVALE AVE 5A',
      city: 'BRONX',
      state: 'NY',
      zip5: '10459',
      mobilityStatusId: '2495',
      evacuationZoneId: '10003239',
      acceptedServices: ['PCA', 'RN', 'PA', 'OT'],
    });
    expect(xml).toContain('<PatientID>958000</PatientID>');
    expect(xml).toContain('<AddressID>2966779</AddressID>');
    expect(xml).toContain('<Zip4 xsi:nil="true" />');
    expect(xml).toContain('<Discipline>OT</Discipline>');
    expect(xml).toContain('<MobilityStatusID>2495</MobilityStatusID>');
    expect(xml).toContain('<EvacuationLocationID xsi:nil="true" />');
  });
});

describe('parseDemoEchoFromXml', () => {
  it('requires AddressID from GetPatientAddress', () => {
    expect(() =>
      parseDemoEchoFromXml(
        1,
        `<Patient><FirstName>A</FirstName><LastName>B</LastName><BirthDate>2000-01-01</BirthDate><Zip5>11201</Zip5></Patient>`,
        `<Addresses></Addresses>`,
      ),
    ).toThrow(/AddressID/);
  });

  it('merges demographics + address', () => {
    const demo = parseDemoEchoFromXml(
      958000,
      `<Patient>
        <FirstName>ALFREDA</FirstName><LastName>JONES</LastName>
        <BirthDate>1960-03-25</BirthDate><Gender>Female</Gender>
        <CoordinatorID1>25164</CoordinatorID1>
        <AcceptedServices><Discipline>PCA</Discipline><Discipline>RN</Discipline></AcceptedServices>
        <MobilityStatus><ID>2495</ID></MobilityStatus>
        <EvacuationZone><ID>10003239</ID></EvacuationZone>
      </Patient>`,
      `<Addresses><AddressID>2966779</AddressID><Address1>1 St</Address1><City>BRONX</City><State>NY</State><Zip5>10459</Zip5></Addresses>`,
    );
    expect(demo.addressId).toBe('2966779');
    expect(demo.acceptedServices).toEqual(['PCA', 'RN']);
    expect(demo.mobilityStatusId).toBe('2495');
  });
});
