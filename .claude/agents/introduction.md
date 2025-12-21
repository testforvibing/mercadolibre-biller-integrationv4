Introduction
Welcome to Wix's Velo API Reference. This reference is your comprehensive guide to using Velo, Wix's powerful JavaScript-based development platform, to create dynamic and interactive web experiences. Velo empowers you to take full control of your site, from frontend design to backend functionality.

Using the SDK: You can now use the Wix JavaScript SDK instead of Velo APIs for most functionality when developing sites or building apps with Blocks. This marks the beginning of a gradual transition from using Velo APIs to using the next generation SDK.

Velo API reference restructure
The transition to the SDK is a gradual process. At this stage, not all Velo APIs have SDK equivalents that can be used in the context of site development or app creation with Blocks. The Velo API reference has been restructured to reflect this and now consists of the following sections:

Velo-Only APIs: The SDK doesn't support the functionality of these APIs. If you want to use the functionality of these APIs, you need to continue to use the existing Velo APIs.
APIs: The SDK supports the functionality of these APIs. If you want to use the functionality of these APIs, we recommend that you use the SDK.
Events & Service Plugins: Most of these Velo APIs have SDK counterparts. However, the SDK counterparts don't currently support site development or app creation with Blocks. Included in this section are APIs for backend event handlers, service plugins, data hooks, and routers. If you want to use the functionality of these APIs for these purposes, you should continue using the existing Velo APIs.

About module names
The meanings of module names can change between versions. Use this guide to understand the different module names:

Version 2 modules include .v2 at the ends of their names.

Module name	Version 1	Version 2 and up
wix-{module}	A module that only works with frontend code.
Exceptions: wix-data, wix-fetch, wix-router	A universal module.
wix-{module}-backend	A module that only works with backend code.	A module that only works with backend code.
wix-{module}-frontend	A module that only works with frontend code.	A module that only works with frontend code.
Universal modules
In the first version of the API, modules were mostly divided between frontend and backend functionality. Frontend modules could only be imported directly into public and page code, and backend modules could only be imported into backend code files. This meant that in order to expose backend functionality in frontend code, you had to create a web module and export functions from it, which could then be imported into frontend code.

From version 2 and up, modules support universal functionality. Universal modules simplify coding by allowing you to import modules directly into any code file on your site. You can identify universal modules by looking for a .v2 or higher suffix in the module name. If the module name doesn't indicate that it's specifically for frontend or backend code, it's a universal module.

Within universal modules, some functions may still be limited to backend use only. These functions are indicated by the following notation in the API Reference:
This function is not a universal function and only runs on the backend.

API Query Language
The query language described in this article is implemented partially or in full by certain Wix Velo APIs that support query capabilities.

Velo query techniques
2 types of query techniques are available in Velo. See your specific API to check which technique the query function supports.

With query builders: Call query functions that build a query to retrieve a list of items. You can recognize these query functions because they have associated <item>QueryBuilder and <item>QueryResult class objects. This is the standard Velo querying technique.

These query functions do not use the API query language syntax described here.

Without query builders: Some query functions retrieve a list of items using the API Query Language described in this article. For these queries, pass an object defining the query to the query function.

Query syntax
You can pass some or all of the following properties to the query function to define the query:

filter: Which results to return.
sort: In what order.
paging: Return only some of the matched entities.
fields: Field projection. Returns only part of each entity.
fieldsets: Predefined, named sets of fields for common use cases. This is a shorthand provided by individual APIs.
Usually these query properties are contained in a query object.

In some cases, the query object might be wrapped inside an options object.
In other cases, the query's properties might be defined directly inside an options object (without being wrapped in a query object).
See your specific API for information on how to define the object you need to pass to the query function.

Specifying an empty object as a parameter to a query function returns all items according to the API's default paging and sort order.

The filter object
The filter is a single object { } with the following syntax for specifying operators:

Equality
The format { "<field>": <value> } specifies an equality condition.

For example, { "status": "DONE" } matches all entities where status is "DONE".

Operators
Operators use the format { "<field>": { "$<operator>": <value> } }.

For example, { "status": { "$in": ["PENDING", "DONE"] } } matches all entities where status is "PENDING" or "DONE".

The operators specified below are supported. See the specific API for information on supported filter options for the query function you are using.

Comparison operators
$eq: Matches values that are equal to a specified value.
$ne: Matches all values that are not equal to a specified value.
$gt: Matches values that are greater than a specified value.
$gte: Matches values that are greater than or equal to a specified value.
$lt: Matches values that are less than a specified value.
$lte: Matches values that are less than or equal to a specified value.
$in: Matches any of the values specified in an array.
$nin: Matches none of the values specified in an array.
$startsWith: Matches strings that start with a specified value. Not case-sensitive.
$isEmpty: Matches strings or arrays that are empty or not empty, depending on whether the specified operand is true or false.
Logical operators
$and: Joins query clauses with a logical AND and returns all items that match the conditions of both clauses.
$or: Joins query clauses with a logical OR and returns all items that match the conditions of either clause.
$not: Inverts the effect of a query expression and returns items that don't match the query expression.
Element operators
$exists: Matches items where the specified field exists and has a non-null value.
Array operators
$hasAll: Matches arrays that contain all elements specified in the query.
$hasSome: Matches arrays that contain at least one element specified in the query.
Sample queries
In the following example, the compound query returns all entities where the status equals "A" and either qty is less than 30 or item starts with the character p:

Copy
{
  "status": "A",
  "$or": [
    {
      "qty": { "$lt": 30 }
    },
    {
      "item": { "$startsWith": "p" }
    }
  ]
}
The following example queries entities where the field tags value is an array with exactly two elements, "red" and "blank", in the specified order:

Copy
{
  "tags": ["red", "blank"]
}
The following example queries for all entities where tags is an array that contains the string "red" as one of its elements, or that tags is the string "red":

Copy
{
  "tags": "red"
}
The following query matches entities that do not contain the item field, or where the item field has no value:

Copy
{
  "item": { "$exists": false }
}
The sort array
sort is an array of field names and sort order. If order is not specified for a field, the field is sorted in ascending order. Sorting is applied to the first sort item, then the second, and so on:

Copy
{
  "sort": [
    {
      "fieldName": "sortField1"
    },
    {
      "fieldName": "sortField2",
      "order": "DESC"
    }
  ]
}
The paging object
The paging object describes the size of the data set to return per response and how many records to skip. Each API can support offset paging, cursor paging, or both. See your specific API for information on supported paging options.

Offset paging
With offset paging, you provide a limit and offset with each request. To retrieve additional pages, submit subsequent requests with an increased offset equal to the previous page's limit plus offset.

For example, this offset request returns records 41 through 60:

Copy
{
  "paging": {
    "limit": 20,
    "offset": 40
  }
}
Cursor paging
With cursor paging, each request returns a cursors object that contains cursor strings that point to the next page, previous page, or both. To retrieve either page, use the returned next or prev cursor in the next request's cursor parameter.

Take this response object, for example:

Copy
{
  "pagingMetadata": {
    "count": 10,
    "offset": 0,
    "cursors": {
      "next": "eyJmaWx0ZXIiOnsiJGFuZCI6W3sibGFuZ3VhZ2UiOnsiJGluIjpbImVuIiwiaGUiXX19LHsic3RhdHVzIjoicHVibGlzaGVkIn1dfSwidmFsdWUiOnsiaXNQaW5uZWQiOmZhbHNlLCJmaXJzdFB1Ymxpc2hlZERhdGUiOiIyMDIyLTA2LTAyVDA2OjQ2OjAyLjgwMloifSwib3JkZXIiOnsiaXNQaW5uZWQiOi0xLCJmaXJzdFB1Ymxpc2hlZERhdGUiOi0xLCJpZCI6LTF9fQ=="
    }
  }
}
You can use the returned next cursor to retrieve the next page of results by forming your request like this:

Copy
{
  "query": {
    "cursorPaging": {
      "cursor": "eyJmaWx0ZXIiOnsiJGFuZCI6W3sibGFuZ3VhZ2UiOnsiJGluIjpbImVuIiwiaGUiXX19LHsic3RhdHVzIjoicHVibGlzaGVkIn1dfSwidmFsdWUiOnsiaXNQaW5uZWQiOmZhbHNlLCJmaXJzdFB1Ymxpc2hlZERhdGUiOiIyMDIyLTA2LTAyVDA2OjQ2OjAyLjgwM1oifSwib3JkZXIiOnsiaXNQaW5uZWQiOi0xLCJmaXJzdFB1Ymxpc2hlZERhdGUiOi0xLCJpZCI6LTF9fQ"
    }
  }
}
The fields array
fields is an array of field paths to return.

If a field path points to an object, the entire sub-object is returned. Subsets of sub-objects can be returned by using dot notation. In this example, the returned entities contain firstName from the name sub-object and the entire address object:

Copy
{
  "fields": ["name.firstName", "address"]
}
The fieldsets array
An API may provide named projections to save clients from specifying individual fields in common cases.

For example, the Contacts API implements a fieldset named BASIC that contains only id, revision, info.name.first, info.name.last, primaryInfo.email, and primaryInfo.phone.

To use a fieldset, specify its name in the fieldsets array.

If both fieldsets and fields arrays exist, the union of both is returned. For example:

Copy
{
  "fieldsets": ["BASIC"]
}


About Velo
Velo is a full-stack development platform that empowers you to rapidly build, manage and deploy professional web apps. It allows you to develop smarter and deliver faster.

This Getting Started walks you through many of Velo's core features and gives you a great foundation to build on.

We cover everything from the basics of writing code that works with page elements to the advanced functionality you can build using backend code. Along the way, we introduce you to some of the mostly commonly used Velo APIs and some of the tools you can use to build, test, and monitor your site.

Each topic we examine here contains an explanation and an example that deals with the main uses of the API or feature being discussed. Often, we will also point you to other Velo resources where you can explore any details we've omitted here.

We will also use a fully-built, functioning site to demonstrate the concepts that you're learning. Use the site to get a better feel for how Velo is used in a real-world situation. 

Prerequisites
We assume that you're already familiar with the basic functionality of the Wix Editor, such as creating pages and adding page elements. If you haven't been introduced to the Editor yet, you can read all about it in the Help Center.

We also assume that you have a working knowledge of JavaScript. If you know what a Promise is, you know the difference between false and falsy, and you think at least some of the JavaScript jokes you see online are funny, you should be fine.

Getting Oriented
Note: These guides are based on a Wix Editor site. You can adapt the procedures for a Wix Studio site by using the equivalent Wix Studio features.

Let's begin by getting familiar with the Velo development environment. The environment contains the tools you need to develop a Velo app.


Enabling Velo
Before beginning with Velo, you need to turn Dev Mode on. To do so, go to Dev Mode in the Editor's top bar and click Turn on Dev Mode in the popup box.

Turn on Dev Mode

Once you enable Velo, you see some additional panels appear in the Editor. Let's take a look at what these panels are and what you do with them.

Velo Editor Panels

Code Panel
The Code Panel appears at the bottom of the page. This is where you do most of your work in Velo. You write all the code for your site, whether it be frontend or backend code, in this panel. 

The Code Panel is a fully-functional code editor that's packed with features, such as autocomplete and error checking, to help you write Velo code as quickly and efficiently as possible.

Code Panel

In the Code Panel, you can have multiple code files open in tabs. The left-most tab is always the page code for the current page showing in the Editor. As you change pages in the Editor, the code in this tab will change accordingly. You cannot close this tab. 

Changing pages in the Code Panel

You can open additional tabs that can contain site code, public code, and backend code.

Properties & Events Panel
The Properties & Events Panel is docked to the right side of the Code Panel when shown. It contains information about the page element currently selected on the page.

Properties & Events Panel

The Properties & Events Panel contains the following information about the selected element:

ID: A unique element identifier. Use the ID in code to refer to the element.
Default Values (when applicable): Several values that determine the state of the element when the page loads. For example, whether the element is hidden.
Event Handlers: Wiring to functions that handle events that occur to the element.
Velo Sidebar
The Velo Sidebar is where you navigate to all the code files and database collections in your site. You can also use the sidebar to access production tools.

Velo Sidebar

The Velo Sidebar contains the following tabs, described in detail below:

Page Code
Code Files
Search Your Code
Databases
Velo Tools
Velo Help
Page Code
The Page Code tab lists all of your site's pages as well as your site's global code. You can use the Page Code tab to navigate to your site's pages in the Editor and open their corresponding code files.

Velo Sidebar - Page Code tab

The Page Code tab includes all of the following that are relevant to your site:

Main Pages: Regular pages and their corresponding code files. 
Dynamic Pages: Dynamic pages and their corresponding code files.
Router Pages: Router pages and their corresponding code files. The code for a router's routing logic is contained in the Backend section of the Code Files tab. We will not discuss routers here.
Members Area: Members area pages and their corresponding code files for your site's member area, if you've added one. These pages may also include pages added by Wix Apps that use the members area, such as the Stores and Blog apps.
Lightboxes: Lightboxes and their corresponding code files.
Global: Code that runs on all of your site's pages. The code is written in the masterPage.js file. It can include general global code and code that works with page elements set to show on all of your site's pages.
Code Files
The Code Files tab contains all of your site's non-page code files.

Velo Sidebar - Code Files tab

The Code Files tab includes all of the following that are relevant to your site:

Public files: Public code that can be accessed by your frontend and backend code.
Backend files: Backend code, including:
Regular backend JavaScript files.
Backend JavaScript web modules, whose code can be called from the frontend. Web module files end with the .jsw extension.
JavaScript files with special meaning in Velo, such as:
data.js: Contains data hooks. We will not discuss data hooks here.
http-functions.js: Contains functions your site exposes as an API.
routers.js: Contains routing logic for any site routers. We will not discuss routers here.
Configuration files, such as:
 jobs.config: Contains configuration information for the job scheduler.
Packages:
npm
npm packages installed on your site
Velo: The Velo packages installed on your site
Search Your Code
The Search Your Code tab contains a search mechanism that allows you to perform a global search on all of your code files. Package code is not searched.

Velo Sidebar - Search Your Code tab

Databases
The Databases tab contains all of your site's database collections.

Velo Sidebar - Databases tab

It includes all of the following that are relevant to your site:

Collections that you've created.
Collections that belong to Wix Apps you've added to your site.
Velo Tools
The Velo Tools tab allows you to access several production tools that help you increase the security, debug, and roll out your site.

Velo Sidebar - Velo Tools tab

The following production tools are available:

Release Manager: Allows you to create versions of your site to gradually rollout changes you've made. 
Secrets Manager: Stores API keys and other sensitive information so you can use them safely in your code.
Site Monitoring: Helps you debug your code by viewing live logs or by connecting your logs to a third party monitoring tool.
Velo Help
The Velo Help tab allows you to access a number of Velo resources to learn more or get some help.

Velo Sidebar - Velo Help tab

The following resources are available:

API Reference: The authoritative resource for learning about Velo APIs.
Forum: A growing community of Velo developers where you can ask questions, answer questions, or learn from previous discussions.
Documentation: The documentation portal where you can discover articles, examples, videos, and more.
Give Feedback: A place for you to share feedback with us.
Page Editor
When Velo is enabled, the section of the Editor where you design your page doesn't change much, except for a few minor differences. The main ones that concern us now are the additions to the Tools panel.

Under the Developer Tools section, there are two additional tools when Velo is enabled:

Tools - Developer Tools

The Properties & Events Panel, which we discussed above. 

A Hidden Elements setting, which determines whether elements that are set to be hidden are shown while editing.

Sometimes, while editing your site, you want to see hidden elements so you can design them and place them where you want them to be on the page. Other times, while editing your site, you don't want to see hidden elements because they get in the way of other page elements.

Of course, in preview and on your live site, hidden elements are not shown until you show them with code. 

Developer Console
When you preview your site with Velo enabled, the Developer Console shows at the bottom of the screen. The console displays information that is useful for debugging your code, such as errors, logs, and other messages.

Developer Console

You can set exactly which types of messages are displayed in the Developer Console.

Developer Console views

The following types of messages can be toggled on or off:

Verbose: System log messages detailing what is happening behind the scenes.
Debug: Messages you have logged to the console.
Info: Informational messages that require no action.
Warning: Messages about potential problems in your code. These are highlighted in yellow.
Error: Messages about actual errors in your code. These are highlighted in red.

Handling Element-based Events
Almost all of the page code that a Velo site runs is in response to some sort of event that occurs. We've just seen how you run code to respond to the onReady event. But what about other events like button clicks or mouse hovers?

There are two ways to create element-based events in Velo. The way you choose is sometimes up to personal preference and other times up to what you're using the event for.

Static Event Handlers
A static event handler is one that gets bound while the page is loading. You can use this type of event handler when you already know before the page loads how you want to handle a specific event. This type of event requires wiring in the Properties & Events Panel.

Static event handler wiring

The name of the function wired in the Properties & Events Panel needs to match the name of an exported function in your page code. When the specified event occurs, the function you wired it to runs.

For example, let's say you want to show some text when a visitor hovers over a certain image with the ID myImage. You can select the image in the Editor and use the Properties & Events Panel to add an onMouseIn event. A function stub will be added to the Code Panel.

Then you can define the body of the event handler so it looks something like this:

Copy
export function myImage_mouseIn(event) {
  $w("myText").show();
}
Because static event handlers are wired, you need to be mindful when copying and pasting them to another page. Just copying the code will not work. If you do copy a static event handler function, remember to recreate the wiring on the page you paste it in.

Dynamic Event Handlers
A dynamic event handler is one that you can bind whenever you choose. You can always use this type of event handler instead of a static event handler if you want to. In addition, you can also use it when you don't know how you want to handle a specific event until the page is displayed or even after.

You add a dynamic handler to an element by calling a function on the element. So, to add an onMouseIn event handler to an image dynamically, in comparison to we did above statically, you would write some code like this:

Copy
$w("myImage").onMouseIn((event) => {
  $w("myText").show();
});
Note that when you add a dynamic event handler to an element that already has a handler for that event, the new handler doesn't replace the original one. Instead, it adds another event handler. When the event occurs, all handlers set for the event run.


Frontend APIs
In addition to the $w API, there are a number of other frontend APIs that you can use on your site.

Some of the things you can do with frontend APIs are:

Animate the elements on a page.
Work with your site's contacts and members.
Customize a page's SEO.
And much more.
Here, we'll cover a few of the most common frontend APIs that you can use in your page code.

Importing APIs
Before we start learning about other APIs, we need to see how to import them. 

To use any API other than the $w API, you need to import a module or just the functions you want to work with.

For example, to import the Location API, add this import to the top of your page code:

Copy
import wixLocation from "wix-location";
Or, to just import the to() function from the Location API, add this import instead:

Copy
import { to } from "wix-location";
List of Frontend APIs
In the next few lessons, we'll take a deep dive into a few of the frontend APIs available with Velo.

We'll look at the following APIs:

wix-location - For working with the current page's URL and for navigating to other pages.
wix-window - For working with the current browser window.
wix-storage - For storing information in the visitor's  browser.
In addition to the APIs we'll cover, there are a number of other APIs that you can use on the frontend. The following is a list of general frontend APIs, excluding APIs that are used for customizing Wix Apps, such as the wix-stores API.

wix-animations - For animating the elements on a page. 
wix-crm - For working with contacts.
wix-data - For working with a site's database collections. We'll see some basic uses of this API later.
wix-fetch - For getting data from 3rd party services. We'll see a use of this API from backend code later.
wix-realtime - Used in conjunction with the wix-realtime-backend API to send and receive messages in real time.
wix-search - For adding search functionality to your site. We'll use datasets and the wix-data instead of wix-search to add search functionality to our Give & Get site.
wix-seo - For working with SEO.
wix-site - For working with the site as a whole.
wix-members-frontend - For working with logged-in members.

Location API
The Location API contains functionality for working with a page's URL and for navigating visitors to other pages. 

Let's take a look at some of the functionality that's available in the Location API.

Query Parameters
There are many situations where you might want to read query parameters from a page's URL or to edit the query parameters in the URL. 

For example, you might want to send information between pages using query parameters. Or you might want to update the query parameters on a page that displays dynamic content to reflect the current content shown on the page.

Reading Query Parameters
To read query parameters from a URL, use the query property. The query property returns an object where the keys of the object are the keys in the URL's query string and the values in the object are the corresponding values in the query string.

For example, let's say you have a URL like this:

Copy
www.mysite.com/page?key1=value1&key2=value2
You can retrieve the query parameters like this:

Copy
const query = wixLocation.query;
The query variable will then contain the following object:

Copy
{ key1: "value1", key2: "value2" }
Editing Query Parameters
To edit the query parameters of a URL, use the queryParams property. The queryParams property returns an object with functions for adding and removing query parameters.

The add() function adds new key

pairs to the query string or replaces existing ones. You call the function by passing an object that contains the key
pairs you want to add or update.
So, if you start with a URL like this:

Copy
www.mysite.com/page?key1=value1&key2=value2
Then, you call the add() function like this:

Copy
wixLocation.queryParams.add({ key2: "new2", key3: "value3" });
The URL will look this this:

Copy
www.mysite.com/page?key1=value1&key2=new2&key3=value3
As you can see, the following occurs:

The value for key1 remains the same since it was not included in the object passed to the add() function.
The value for the original key2 is replaced by the new value passed to the add() function.
The key key3 and its value are added because key3 did not exist in the original URL.
The remove() function removes existing key

pairs from the query string. You call the function by passing an array of the keys you want to remove.
So, if you start with a URL like this:

Copy
www.mysite.com/page?key1=value1&key2=value2&key3=value3
Then call the remove() function like this:

Copy
wixLocation.queryParams.remove(["key1", "key3"]);
The URL will look like this:

Copy
www.mysite.com/page?key2=value2
Navigating
You may want to write code that sends visitors to another page in your site or to an external address. There are a couple of ways to accomplish this.

If you want to send a site visitor to another page in response to a click on an element that has a link property, you can use that property to define where the visitor will be sent.

For example, this code sets the link for a button, depending on whether the current member is logged in:

Copy
import { getCurrentMember } from "wix-users";

$w.onReady(async function () {
  const currentMember = await getCurrentMember();
  let link = "";

  if (currentMember) {
    link = "/account/my-account";
  } else {
    link = "/signup";
  }
  $w("#button").link = link;
});
When a visitor clicks on the button, the browser will navigate to the appropriate page.

However, there are some situations where you can't use an element's link property to send a visitor to another page, such as when:

The element you want to use to trigger the navigation does not have a link property, like a Box or a Container.
You want to navigate a visitor to another page in response to an action that is not a click.
You want to run some other code in response to a visitor action and then navigate the visitor when that code has finished running.
In these cases, you need to use the to() function. To use the to() function, simply pass it the URL you want to navigate to. You can use relative URLs if you're navigating to a page in the current site.

For example, to implement a submit button for a form, you might want to submit the form data to a database collection and then navigate the visitor to a thank you page. Your code might look something like this:

Copy
$w("#submitButton").onClick(async () => {
  await submitFormData();
  wixLocation.to("/thank-you");
});
Here you can see that the onClick event handler first calls a function to submit the form data to a database collection. When the submission is complete, the visitor is sent to a thank you page.

We've now seen a couple of ways to handle element clicks with code. These are in addition to the ways clicks might be handled using the Editor that we haven't discussed.

That leaves you with lots of options when it comes to clickable elements:

Set the link property in code.
Set an onClick event handler in code.
Set the link behavior using the Editor's link panel.
Connect the Click action or Link connection to a dataset.
Because there are multiple options, and some of them might conflict with each other, it is important to choose only one option per element. If you use more than one option on the same element, the results may be unpredictable.

Window API
The Window API contains functionality for working with the current browser window. 

Some of the functionality in the Window API includes:

Retrieving information about the current visitor's physical location and browser locale settings.
Determining what type of device the current visitor is using to view your site.
Working with lightboxes and modal windows.
Working with the multilingual capabilities of your site.
Copying text to the visitor's clipboard.
Scrolling the current page by a certain amount or to a certain location.
Sending tracking information to external analytics tools.
Let's take a closer look at a couple of these.

Location
Sometimes, you want to know the physical location of your visitors. For example, you might want to show them some location-based information, such as nearby restaurants or other attractions.

You can retrieve a visitor's physical location using the getCurrentGeoLocation() function. Of course, the accuracy of the location data you get depends on the type of device used to view your site as well as other factors. So keep that in mind when making use of this location data.

Another issue to keep in mind when retrieving location data is that the environment you are trying to retrieve the location data from can affect how you get that data, if you get it at all.

Some browsers require visitors to explicitly agree to sharing their location data with you. This usually takes the form of a popup asking visitors if they want to allow your site to retrieve their location data. If they do not agree, the Promise returned by the getCurrentGeoLocation() function rejects.

These protections on the sharing of visitor location data mean you always have to be aware of the possibility that you won't be able to retrieve the visitor's location data and handle it accordingly.

Let's take a look at a simple example that uses the site visitor's location data to show a map of where the visitor is currently located. We display the visitor's location using a GoogleMap element that we've given the ID googleMap. We've set the map to be hidden when the page loads in case we can't retrieve the visitor's location.

Copy
import wixWindow from "wix-window";

$w.onReady(function () {
  wixWindow.getCurrentGeolocation().then((location) => {
    $w("#googleMap").location = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      description: "You are here",
    };
    $w("#googleMap").show();
  });
});
Here you can see that we call the getCurrentGeoLocation() function. If the returned Promise resolves, we set the map element's location to the current visitor's location using latitude and longitude coordinates and show the map.

If the Promise rejects or if it doesn't resolve, the map will remain hidden.

Lightbox
Lightboxes are great for grabbing the attention of your site's visitors. Lightboxes are often used for popping up promotional material, encouraging visitors to join a mailing list, or for action confirmation, such as confirming the deletion of some data.

Lightbox

You can open a lightbox on your site using the openLightbox() function from page code. You choose which lightbox to open by passing the lightbox's name when calling the function.

Tip

Remember to use the lightbox's name, and not its ID. 

When you open a lightbox, it opens on top of the page and runs its own code, which is not connected to the code of the page that opened it. 

When a visitor closes a lightbox that you opened in code, the Promise returned from the openLightbox() function is resolved and you can then handle the closure of the lightbox.

Copy
import wixWindow from "wix-window";

// ...

wixWindow.openLightbox("LightboxName").then(() => {
  // Code here runs when the lightbox is closed
});
You can also pass data from your page to the lightbox when calling the openLightbox() function by passing the data to the function.

You can only pass data to a lightbox if you open it using code. So, if you're passing data to a lightbox, you need to make sure there are no other triggers for opening the lightbox. You need to make sure the lightbox is not set to open automatically and there are no links set to open it. 

Once a lightbox is open, you can retrieve any data you sent to it from your page using the getContext() function.

If you want to send information back to the page that opened a lightbox, use the close() function to close the lightbox and return the visitor to the page. If you're passing information with the closing of the lightbox, you might have to disable all the other ways the lightbox can be closed.

The code below demonstrates the passing of data from a page to a lightbox and from a lightbox back to the page.

Copy
//Page Code

import wixWindow from "wix-window";

// ...

const dataToLightbox = "Message from the page";

wixWindow
  .openLightbox("LightboxName", dataToLightbox)
  .then((dataFromLightbox) => {
    $w("pageMessage").text =
      `This is what the lightbox sent: ${dataFromLightbox}`;
  });
Copy
// Lightbox Code

import wixWindow from "wix-window";

$w.onReady(function () {
  const dataFromPage = wixWindow.lightbox.getContext();
  $w("lightboxMessage").text = `This is what the page sent: ${dataFromPage}`;

  $w("#closeButton").onClick(() => {
    const dataToPage = "Message from the lightbox";
    wixWindow.lightbox.close(dataToPage);
  });
});
The page code creates a message and opens a lightbox. It sends the message when opening the lightbox.

Copy
// Page Code
const dataToLightbox = "Message from the page";

wixWindow.openLightbox("LightboxName", dataToLightbox);
On the other end, the lightbox retrieves the message that was sent from the page and displays it in a text element.

Copy
// Lightbox Code
const dataFromPage = wixWindow.lightbox.getContext();
$w("lightboxMessage").text = `This is what the page sent: ${dataFromPage}`;
Then, the code creates an onClick event handler for the lightbox's close button. When the close button is clicked, a message is created and sent back to the page when closing the lightbox.

Copy
// Lightbox Code
$w("#closeButton").onClick(() => {
  const dataToPage = "Message from the lightbox";
  wixWindow.lightbox.close(dataToPage);
});
Finally, back on the page, the message sent from the lightbox is retrieved and displayed in a text element.

Copy
// Page Code
.then(dataFromLightbox => {
    $w('pageMessage').text = `This is what the lightbox sent: ${dataFromLightbox}`;
});

Storage API
Now let's talk a bit about storing data locally in your site visitors' browsers. Usually, you'll store local data to save a visitor's state between browser sessions or to pass data from one page to another while the visitor navigates your site.

To store data locally, use the Storage API. There are three types of storage you can use. The types of storage differ in how long the data is stored for and how much data can be stored. The type you choose in a specific situation depends on what you're trying to achieve.

The three storage types are:

Type	Expires	Size Limit	Typical Usage
Local	Never, unless manually cleared by the site visitor.	50kb	Store visitor state between sessions.
Session	When the browser tab or window is closed.	50kb	Pass data between pages on the site.
Memory	When the visitor leaves the site or a page is reloaded or refreshed.	1mb	Pass data between pages on the site.
If you're using storage to store state between visitor sessions, keep in mind that the state is stored locally in the visitor's browser. So, if the same visitor visits your site from different devices, you won't be able to restore the proper state.

For cases where you need to store state per visitor across devices, you need to know who your visitors are and store their state remotely on the server. That means having users identify themselves, usually done through a member login process, and using a database collection to track their states.

Learn more

Want to read more about adding membership capabilities to your site? See About the Member Area in the Help Center.
Want to read more about database collections? See About the Content Manager in the Help Center.
Usage
To use the Storage API, start by importing the type of storage you want to use. Then use the storage functions to set, get, and remove stored data. All of the storage types use the same four storage functions:

setItem(): Adds an item to storage
getItem(): Gets an item from storage
removeItem(): Removes all the items from storage
clear(): Removes all the items from storage
Storage items must be string data. If you need to store JSON data, use the JSON.stringify() function when storing the item and the JSON.parse() function when retrieving the item.

Example
Let's see how you can use the Storage API to pass data from one page to another.

Suppose you have a site where you want to show the previous item visitors have viewed when they are viewing the next item. Each time a visitor views an item, you can retrieve the previous item from local storage and then replace it with the current item.

Here's some code you can use to show the previously viewed item on a dynamic page. It assumes that the previous item is displayed using an image and a text element.

The elements that will show the previous item are collapsed when the page loads to account for the case where the current page is the first item page that a visitor is visiting.

Tip

To learn more about dynamic pages, see the Content Manager Learning Center. 

Copy
import { local as storage } from "wix-storage";

$w.onReady(function () {
  let previousItem = JSON.parse(storage.getItem(previousItem));

  if (previousItem) {
    $w("#previousTitle").text = previousItem.title;
    $w("#previousImage").src = previousItem.image;

    $w("#previousTitle").expand();
    $w("#previousImage").expand();
  }

  const currentItem = $w("#dynamicDataset").getCurrentItem();
  storage.setItem("previousItem", JSON.stringify(currentItem));
});
This code begins by importing the local storage module. We import it with an alias just in case we ever want to change the storage type. If we do decide to switch it, all we need to do is change the type in this line.

Copy
import { local as storage } from "wix-storage";
The rest of the code is included in an onReady event handler, which begins by retrieving the recently viewed item from storage.

Remember, all data stored in storage must be stored as a string. So, we use the JSON.parse() function to parse the string and convert it to an array that we can use in code.

Copy
$w.onReady(function () {
  let previousItem = JSON.parse(storage.getItem("previousItem"));

  // ...
});
Then, we check to see if any data was retrieved from storage. If this isn't the first item the visitor is viewing, we'll find the previous item in storage. 

If we have a stored item, we populate its contents into some page elements and expand those elements so they'll be seen on the page. If we don't have a stored item, we do nothing.

Copy
if (previousItem) {
  $w("#previousTitle").text = previousItem.title;
  $w("#previousImage").src = previousItem.image;

  $w("#previousTitle").expand();
  $w("#previousImage").expand();
}
Lastly, we reset the local storage with the current item's data. Since the storage requires a string, we use the JSON.stringify() function to convert the item object before setting it into storage.

Writing Backend Code
Once upon a time, you had to jump through a whole bunch of hoops just to call backend code from the frontend. Not with Velo! Now, you can easily and securely call backend functions from your frontend code using web modules.

There are lots of reasons you might want to use a backend web module. Some of these are:

To keep sensitive code private on the server.
To use Velo APIs that are only available on the backend.
To boost performance by minimizing the amount of data you send to the frontend.
To avoid CORS complications when using the Fetch API.
Other uses for backend code

Besides web modules, you can also write code in the backend that is not accessible from the frontend.

Some of these will be discussed later, such as:

Code that will run as a scheduled job.
Code that you expose as an API for other services to consume.
Other uses of backend code that are not discussed here include:

Creating a router to take complete control when handling incoming requests to your site.
Adding data hooks to intercept interactions with your site's database collections immediately before or after they happen.
Adding backend event handlers to handle events from your site's apps.
Creating a Web Module
Web modules are backend modules containing functions that you want to be able to call from the frontend. To create a web module, just create a new backend file with the .jsw extension. On the backend, code in files with the .js extension can only be called from other backend files. The .jsw extension is what makes a file a web module, allowing its functions to be called from the frontend.

Any function that you export from a web module can then be imported and called from the frontend. It's as simple as that.

For example, let's say you add a backend file named myModule.jsw. A simple function for pulling some data from a database collection would then look like this:

Copy
// In myModule.jsw
import wixData from "wix-data";

export async function getTeamNames() {
  let { items } = await wixData.query("Team").find();

  return items.map((item) => {
    return {
      id: item._id,
      name: item.name,
    };
  });
}
Calling Functions From Web Modules
The first thing you need to do if you want to use a web module function on the frontend is to import the function. You import a function using its name and the path of the module you are importing it from.

Copy
// In some page code

import { getTeamNames } from "backend/myModule";
Obviously, calling a web module backend function from the frontend is a remote call over the network. Because the call is remote, it happens asynchronously. That means, all calls to backend functions from the frontend return a Promise.

Even if your backend function doesn't explicitly return a Promise, a Promise will be returned anyhow. If your backend function returns a value that is not a Promise, that return value is wrapped in a Promise. If your backend function doesn't return anything, a Promise is still returned when it's called from the frontend.

So, when you call a function from a web module on the frontend you need to remember to treat it as an asynchronous function.

For example, let's say you want to call the getTeamNames() function we wrote above. Your function call will look something like this:

Copy
getTeamNames().then((names) => {
  $w("#namesRepeater").data = names;
});
Notice how the getTeamNames() function is called using a then() to handle the returned Promise.

Testing Functions in Web Modules
You can easily test your web module functions right from the code panel. Click the green arrow to the left of the function header to open the testing environment. Read more about testing backend functions in the Testing and Debugging lesson.

Security & Permissions
The code in your backend web modules is not visible to users. However, any code that can be called from the frontend can be called by anyone. So, even though malicious visitors can't see what exported backend functions do, they can still call them with any arguments they want, and examine their return values.

With that in mind, you need to be careful when you export a backend function that performs potentially harmful operations or returns sensitive information. In such cases, the backend function should contain some sort of validation mechanism that prevents malicious visitors from causing damage to your site and its data. 

Backend web modules also have permissions built right into them. You can set specific permissions on a per function basis.

By default, functions can be called from the frontend by anyone, but you can restrict them to only logged-in site members or just the site admin.

Web module permissions

Learn more

Want to read more about backend web modules? See Web Modules: Calling Server-Side Code from the Front-End in the Help Center.

Give & Get Example - Backend Web Modules
Let's take a look at some examples of using a backend web module from our Give & Get site (template). 

We use backend web modules to:

Create a (fictitious) delivery by calling an external delivery API (deliveries.jsw). Writing this code on the backend lets us securely retrieve the API key from the Secrets Manager and avoids any possible CORS issues we might have encountered when using the Fetch API.
Perform data operations on our site's database collections (giveawaysModule.jsw). Writing this code on the backend allows us to centralize all our database interactions in one place, override collection permissions when necessary, and modify the data retrieved from the database before sending it to the frontend.
Let's examine one of the functions from our backend web modules. The getMyGiveaways() function is used to get the giveaways that the current logged-in member has added to the site. The retrieved giveaways are used on the My Giveaways page to show members a list of all the giveaways they added.

Since the My Giveaways page doesn't display all of the information that we store for each giveaway, we can boost performance by only sending it the information it needs. For example, the list of giveaways doesn't display the giveaway descriptions, which can be quite large. So we save some transmission time by not sending the descriptions to the page.

Copy
// In backend/giveawayModule.jsw

import wixData from "wix-data";
import wixUsersBackend from "wix-users-backend";

// ...

export async function getMyGiveaways() {
  const { items: giveaways } = await wixData
    .query("Giveaways")
    .eq("giver", wixUsersBackend.currentUser.id)
    .include("category")
    .find();

  const myGiveaways = giveaways.map((giveaway) => {
    const { _id, title, status, image, category, itemCondition } = giveaway;

    return {
      _id,
      title,
      status,
      image,
      itemCondition,
      categoryTitle: category.title,
      link: giveaway["link-giveaways-title"],
      updateLink: giveaway["link-giveaways-1-title"],
    };
  });

  return myGiveaways;
}
In the web module giveawaysModule.jsw, we start by importing the functionality we need to work with database collections and our site's users.

Copy
import wixData from "wix-data";
import wixUsersBackend from "wix-users-backend";
Then, inside the getMyGiveaways() function we perform a query to find the current user's giveaways from the Giveaways collection. We destructure the query results so that we have the items returned by the query in a variable named giveaways.

Copy
const { items: giveaways } = await wixData
  .query("Giveaways")
  .eq("giver", wixUsersBackend.currentUser.id)
  .include("category")
  .find();
Next we use the JavaScript map() function to create a pared-down version of the giveaway list that only contains the fields that are used on the My Giveaways page.

While we're at it, we also repackage some of the values with new keys to make the giveaway objects easy to use on the frontend.

Copy
const myGiveaways = giveaways.map((giveaway) => {
  const { _id, title, status, image, category, itemCondition } = giveaway;

  return {
    _id,
    title,
    status,
    image,
    itemCondition,
    categoryTitle: category.title,
    link: giveaway["link-giveaways-title"],
    updateLink: giveaway["link-giveaways-1-title"],
  };
});
All there's left to do now is return the new list of giveaways.

Copy
return myGiveaways;
So that's the definition of the getMyGiveaways() function on the backend. Now, let's see how it's called on the My Giveaways page.

Copy
import { getMyGiveaways, removeGiveaway } from "backend/giveawaysModule";

// ...

$w.onReady(function () {
  bindGiveawaysRepeater();
  renderGiveawaysRepeater();
});

// ...

async function renderGiveawaysRepeater() {
  const giveaways = await getMyGiveaways();
  $w("#giveawaysRepeater").data = giveaways;
}
First, we import the getMyGiveaways() function from the backend web module.

Copy
import { getMyGiveaways, removeGiveaway } from "backend/giveawaysModule";
Then, in the renderGiveawaysRepeater() function, which is called from the onReady event handler, we call the function and wait for the returned Promise to resolve. When it resolves we set the page's repeater to the returned giveaways list.

Copy
async function renderGiveawaysRepeater() {
  const giveaways = await getMyGiveaways();
  $w("#giveawaysRepeater").data = giveaways;
}


Integration With Third Party Services
Want to integrate your site with a 3rd party service? No problem. Velo has a Fetch API you can use on either the frontend or backend. The Fetch API is an implementation of the standard JavaScript Fetch API, so you may already be familiar with it.

Tip

You can also use npm and Velo packages to integrate with 3rd party services. Learn more about integrating with third party services using packages in the Packages lesson.

Fetch
Although you can use the Fetch API on the frontend, it's usually best to make your calls to external APIs from the backend for a few reasons:

Calling fetch() from the backend avoids any CORS issues you might have when making certain types of calls from the frontend.
Many APIs require a key or some other form of authentication. For security reasons, you should make such calls in the backend. Also, be sure to use the Secrets Manager to securely store your API keys.
Retrieving data from the backend allows you to improve the performance of the data retrieval.
The API call from the backend is guaranteed to happen over a fast network, where a call from a visitor's browser could be over a slower connection.
If the API you call returns a lot of data that you don't need on the frontend, you can selectively just return the data you need.
Let's take a look at a simple example of hitting an external endpoint. Here we'll use an API that returns interesting quotes. The API returns a JSON response in the following format:

Copy
{"quote": "This is the quote text."}
The code to retrieve the text of the quote looks like this:

Copy
// In a backend web module

import { fetch } from "wix-fetch";

export async function getQuote() {
  const response = await fetch("https://somequotesapi");
  const json = await response.json();

  return json.quote;
}
We begin by importing the fetch() function. Use this same import statement whether you're using fetch on the frontend or the backend.

Copy
import { fetch } from "wix-fetch";
In this example, we're calling fetch from the backend and we want to return the fetched data to the frontend so we create an exported function. 

Copy
export async function getQuote() {
  // Fetch data from an external API
}
Inside the exported function, we call fetch() and pass the URL of the endpoint we want to reach.

Copy
const response = await fetch("https://somequotesapi");
The fetch() function returns a Promise that resolves to an HTTP response object. The API we use in this example returns a JSON payload. To get the JSON data we need to call the json() function which also returns a Promise.

Copy
const json = await response.json();
Finally, we can return the data we want from the JSON payload. In this case, we want to return the value of the quote property.

Copy
return json.quote;
Fetching JSON Data
If you're fetching JSON data using the GET method, there is a convenience getJSON() function that allows you to do away with the double set of Promises. The function returns a Promise that resolves directly to the JSON data without going through the HTTP response first.

So the same API call we made above can be simplified to:

Copy
import { getJSON } from "wix-fetch";

export async function getQuote() {
  const json = await getJSON("https://somequotesapi");
  return json.quote;
}
Fetching With Options
Although the getJSON() function is convenient, it only works for some API calls. If you need to make an API call using any HTTP method other than GET or if the API returns anything other than JSON data, you need to use the fetch() function.

In addition to the URL of the endpoint you're trying to reach, you can pass an options object to specify the HTTP method to use, request headers, a request body, and more.

For example, a POST call might look something like this:

Copy
import { fetch } from "wix-fetch";

export async function postSomeData() {
  const response = await fetch("https://someapi.com/api/someendpoint", {
    method: "post",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(someObject),
  });

  if (response.ok) {
    return response.json();
  }
}
As we've seen already, you can use the response returned by fetch() to retrieve the body of the APIs response. The response object also contains information about the response status, headers, and more.

Learn more

Want to read more about the Fetch API? See wix-fetch in the API Reference.

Secrets Manager
Lots of APIs require you to authenticate when using them. The Secrets Manager is a secure place to store all of your API keys and any other sensitive information.

Secrets Manager

You can find the Secrets Manager in the Settings section of your site's dashboard.

When you need to use any of the secrets you store in the Secrets Manager, use the Secrets API. Because secrets are sensitive information, you can only work with them on the backend and you should never send them to the frontend.

Use the getSecret() function to retrieve a key from the Secrets Manager by name.

For example to call an external API that requires you to use an API key in a query parameter you would write some code like this:

Copy
import { getJSON } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';

// …

export function callApi() {
    const apiKey = await getSecret('apiKey');

    return getJSON(`https://someapi?key=${apiKey}`);
}

Give & Get Example - Integrating With Third Party Services
Let's take a look at an example of how we integrate with third party services from our Give & Get site (template). 

We integrate with a (fictitious) delivery service to schedule deliveries for giveaways that visitors have requested.

The delivery service API works as follows:

It's called using the POST method.
Authentication is with an API key in the request header. The requesting URL includes one parameter, which is an encrypted ID of the giveaway to be delivered.
The request body is a JSON object containing the following information:
origin: The address of the giveaway giver.
destination: The address of the giveaway receiver.
callbackURL: URL of our site's HTTP function that the delivery service will call when the item is delivered.
The API returns a JSON object containing the following information:
success: Whether a delivery was successfully created.
trackingURL: A URL to a page for tracking the delivery.
Note

To retrieve an API key to use the (fictitious) delivery service, go to our Blink Shipper site. If you're working on your own version of the Give & Get site, add the key to the Secrets Manager using the name deliveryKey.

Let's take a look at the code that creates a delivery for a requested giveaway. The code is in the deliveries.jsw backend web module.

Copy
// In backend/deliveries.jsw

import { getSecret } from "wix-secrets-backend";
import { fetch } from "wix-fetch";
import { createCallbackURL } from "backend/deliveryServiceHelper";

export async function createDelivery(giveawayAddress, userAddress, giveawayId) {
  const callbackURL = await createCallbackURL(giveawayId);
  const deliveryKey = await getSecret("deliveryKey");
  const APIEndpoint =
    "https://www.wix.com/velo-dev/fake-api/_functions/delivery";

  const body = {
    origin: giveawayAddress,
    destination: userAddress,
    callbackURL,
  };

  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deliveryKey}`,
    },
    body: JSON.stringify(body),
  };

  const httpResponse = await fetch(APIEndpoint, options);

  return httpResponse.json();
}
We begin by importing the getSecret(), fetch(), and createCallbackURL() functions.

The createCallbackURL() function is imported from some backend code we've written. We'll see the definition of this function in a later lesson.

Copy
import { getSecret } from "wix-secrets-backend";
import { fetch } from "wix-fetch";
import { createCallbackURL } from "backend/deliveryServiceHelper";
Next, in the exported createDelivery() function, we create a callback URL using the createCallbackURL() function.

Copy
const callbackURL = await createCallbackURL(giveawayId);
After that, we get our key for the delivery API from the Secrets Manager and we store the URL of the API endpoint.

Copy
const deliveryKey = await getSecret("deliveryKey");
const APIEndpoint = "https://www.wix.com/velo-dev/fake-api/_functions/delivery";
Next, we build the request body.

Copy
const body = {
  origin: giveawayAddress,
  destination: userAddress,
  callbackURL,
};
Then, we build the request options.

We define the request method to be POST. In the headers we set the right content type and send the authorization with the key we retrieved from the Secrets Manager. We also add the body we built above.

Copy
const options = {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${deliveryKey}`,
  },
  body: JSON.stringify(body),
};
All that's left to do at this point is to make the API call and return the result.

Copy
const httpResponse = await fetch(APIEndpoint, options);

return httpResponse.json();

Packages
Packages are another way to integrate with 3rd party services, in addition to using the Fetch API discussed in the previous lesson. You can also use packages for any number of other reasons. If there's a package out there that's already implemented some functionality that you need, there's no point in reinventing the wheel.

There are two types of package that you can use in your code:

Packages from the npm repository.
Packages created by the Velo team.
npm Packages
As you probably already know, npm is the most popular registry of reusable JavaScript code. Velo allows you to install approved npm packages and use them in your site. If a package you would like to use has not yet been approved, you can request that it be added to the list of approved packages. 

Package Support
Some types of packages are not supported. These include private packages, packages that need to run on specific hardware, and packages that may expose a security risk.

Here are a few things to consider when using an approved package in your code:

Some packages are only intended to be used in client-side code and others are only intended to be used in server-side code. Be sure to use packages in their intended locations.
Some packages contain functionality that interacts with the DOM. In Velo, you use $w APIs to interact with page elements instead of interacting directly with the DOM, so some functionality in these packages will not work.
Some packages work with React or other JavaScript libraries. You can only use these packages in conjunction with custom elements if at all.
Errors that occur when using a package's functionality may be reflected in the browser console. These errors are generated by the implementation of the package, not from Velo. See the package's documentation to better understand what is causing the error.
It is your responsibility to understand the package's functionality, in what situations it can be used, and in what situations it should not be used.

Package Usage
You find and install packages in the Code Files tab of the Velo Sidebar. Once installed, you can import the package and use it in your code.

For example, you might want to install Lodash to make use of its handy utility functions. First, you need to install the package. Just choose your package, and click Install. Then you can import it and use its functionality.

Copy
import _ from "lodash";

// ...

let union = _.union([1, 2, 3], [3, 4, 5]);
Velo Packages
Velo packages are bundles of code built by the Velo team that you can add to your site. The packages allow you to quickly implement complex functionality while writing a minimal amount of code. 

Because these packages are specifically built to work within the Velo ecosystem, they work seamlessly with the elements, apps, and APIs you use in your sites.

See a package's readme file to learn how to use the package. Each package is different, but typically you need to perform some setup or configuration before using the package. You also might need to install some dependencies, such as apps that the package works with.

You find and install Velo packages in the Code Files tab of the Velo Sidebar. 

With everything set up, you're ready to start using the package.

For example, you can easily monitor and manage data stored in a Google spreadsheet from your site using the @velo/google-sheets-integration package.

Since the google-sheets-integration package uses the Google Sheets API, you need to do a bit of setup on the Google Cloud Platform before using it. You also need to store some sensitive data in the Secrets Manager.

Once you have that set up, you can use the package to:

Get data from your spreadsheet
Add new data to your spreadsheet
Update data in your spreadsheet
Clear data from your spreadsheet

Give & Get Example - Packages
On our site, we've installed: 

The jsonwebtoken npm package to encrypt and decrypt giveaway IDs that we send to the (fictitious) delivery service.
The @velo/wix-animation-helper Velo package to create a spinning animation on the Home page.
npm Package
When we send a giveaway ID to the delivery service we use the jsonwebtoken npm package to encrypt the ID before sending it. We create a callback URL that includes the encrypted ID. The delivery service will use this URL to let us know the giveaway has been delivered.

Copy
// In backend/deliveryServiceHelper.jsw

import { getSecret } from "wix-secrets-backend";
import { verify, sign } from "jsonwebtoken";

export async function createCallbackURL(giveawayID) {
  const secretKey = await getSecret("secretKey");
  const encryptedGiveawayID = sign(giveawayID, secretKey);

  const baseURL = "https://www.wix.com/corvid-pro/agora/";

  return `${baseURL}_functions/giveawayDelivered/${encryptedGiveawayID}`;
}
Then, when the delivery service lets us know that the giveaway has been delivered, we decrypt the ID so we can update the delivered giveaway's data in the Giveaways collection.

Copy
// In backend/deliveryServiceHelper.jsw

export async function decryptGiveawayID(encryptedGiveawayID) {
  const secretKey = await getSecret("secretKey");
  return verify(encryptedGiveawayID, secretKey);
}
Velo Package
Towards the bottom of the Home page, we add a little pizzazz to our site by creating some text that rotates around our logo. Thanks to the wix-animation-helper Velo package we can create this effect with a single import and one line of code.

Copy
import { spin } from "@velo/wix-animation-helpers";

$w.onReady(function () {
  // ...

  spin("#rotateBadge", { duration: 30000 });
});
We start by importing the spin() function from the Velo package.

Copy
import { spin } from "@velo/wix-animation-helpers";
Then, inside the onReady event handler, we simply call the rotate function. When we call it, we pass the element that we want to spin and how long, in milliseconds, each rotation should take.

Copy
$w.onReady(function () {
  // ...

  spin("#rotateBadge", { duration: 30000 });
});

Schedule Jobs
There are many situations in which you want to schedule some code to run at a specific recurring interval. In Velo, you can create jobs and schedule them to run on an hourly, daily, weekly, or monthly basis using the Job Scheduler. 

Some common uses of the Job Scheduler are to:

Import or export data once a day.
Delete collection data that is no longer relevant once a week.
Send a status report to relevant parties once a month.
Creating a Scheduled Job
To configure scheduled jobs, start by creating file in the backend root named jobs.config. The file must contain a JSON object that defines the jobs you want to schedule. You can configure up to twenty jobs.

A job's configuration defines when the job runs and what code it runs. A job can run any backend function defined in your site. Each job is represented by an object in the jobs array.

Copy
// In backend/jobs.config

{
    "jobs": [
        {
            "functionLocation": "/someBackendFile.js", 
            "functionName": "someBackendFunction",
            "description": "Some job description",
            "executionConfig": {
                "dayOfWeek": "Monday",
                "time": "08:00"
            }
        }
    ]
}
Each job definition contains the following information:

functionLocation: Path to the backend file in which the job function resides.
functionName: Name of the function to run at the scheduled time.
description: Optional job description.
executionConfig: Configuration that defines when the job runs.

There are two mutually exclusive ways to define when the job runs:

Using the time property and optional dayOfWeek or dateInMonth properties.
Using a CRON expression.
A few more things to keep in mind when scheduling jobs are:

All times in job configurations are UTC time. 
If you want to schedule a job to occur more than once a day, you need to use a cron expression. 
The shortest interval you can define for a job is one hour. Jobs scheduled more frequently are ignored.
You need to publish your site for any changes to your scheduled jobs to take effect.
Example
Now that you know the rules, let's take a look at some examples of scheduled jobs.

Copy
// In backend/jobs.config

{
    "jobs": [
        {
            "functionLocation": "/utils.js", 
            "functionName": "sendStatusReport",
            "description": "Send a morning status report",
            "executionConfig": {
                "cronExpression": "0 8 * * MON"
            }
        },  
        {
            "functionLocation": "/utils.js",
            "functionName": "cleanDb",
            "description": "Delete stale items from the DB",
            "executionConfig": {
                "time": "01:00",
                "dateOfMonth": 1
            }
        }
    ]
}
Here you can see two scheduled jobs. The first job is scheduled using a cron expression and it sends a status report every Monday morning at 8

in the morning UTC time.
Copy
"executionConfig": {
    "cronExpression": "0 8 * * MON"
}
The second job is scheduled using the time and dateOfMonth properties and it deletes stale items from the site's database at one in the morning UTC time on the first day of every month.

Copy
"executionConfig": {
    "time": "01:00",
    "dateOfMonth": 1
}

Give & Get Example - Scheduling Jobs
Let's take a look at an example of a scheduled job from our Give & Get site (template). 

On our site, we use a scheduled job to remove giveaways that were either added or last updated over two months ago. 

The job configuration looks like this:

Copy
{
    "jobs": [
        {
            "functionLocation": "/giveawaysModule.jsw",
            "functionName": "removeOldGiveaways",
            "description": "A daily checkup that removes old giveaways",
            "executionConfig": {
                "time": "08:00"
            }
        }
    ]
}
As you can see the job is configured to call the removeOldGiveaways() function from giveawaysModule.jsw once a day at 8

in the morning UTC time.
The removeOldGiveaways() function looks like this:

Copy
export async function removeOldGiveaways() {
  const now = new Date();
  const twoMonthsAgo = new Date(
    now.getFullYear(),
    now.getMonth() - 2,
    now.getDate(),
  );

  const { items: oldGiveaways } = await wixData
    .query("Giveaways")
    .lt("_updatedDate", twoMonthsAgo)
    .find();

  const oldGiveawaysIDs = oldGiveaways.map((giveaway) => giveaway._id);

  wixData.bulkRemove("Giveaways", oldGiveawaysIDs);
}
We begin by calculating the date of the day that occurred two months ago. 

Copy
const now = new Date();
const twoMonthsAgo = new Date(
  now.getFullYear(),
  now.getMonth() - 2,
  now.getDate(),
);
Then, we find the giveaways that are older than two months old.

Copy
const { items: oldGiveaways } = await wixData
  .query("Giveaways")
  .lt("_updatedDate", twoMonthsAgo)
  .find();
Next, we extract the IDs from the old giveaways. We need these to delete them.

Copy
const oldGiveawaysIDs = oldGiveaways.map((giveaway) => giveaway._id);
Finally, we remove all the old giveaways using the bulk removal operation.

Copy
wixData.bulkRemove("Giveaways", oldGiveawaysIDs);


Expose an API
With Velo, you can choose to expose some of your site's functionality as an API for other systems to consume. You expose an API by creating HTTP functions.

You might want to use HTTP functions to:

Integrate your site with an automation tool, such as Zapier or IFTTT.
Receive notifications and information from external webhooks. 
Access your site's backend from a native mobile application.
Creating an HTTP Function
For each API endpoint you want to create you need to define an HTTP function. An HTTP function is a backend function that conforms to certain conventions. 

Location
First off, the implementation of your HTTP functions must be in the root backend folder in a file named http-functions.js. 

Naming
Within the http-functions.js file, your code needs to conform to the following conventions:

Each endpoint you want to expose is implemented in an exported function.
The function name begins with a prefix that determines the HTTP method (get, post, push, or delete) it handles followed by an underscore (_). Catch all functions that handle multiple HTTP methods begin with the prefix use.
The remainder of the function name is the name of your endpoint.
For example, an endpoint named myFunction that handles GET requests, looks like this:

Copy
// In backend/http-functions.js

export function get_myFunction(request) {
  // endpoint implementation goes here
}
Implementation
Of course, you can implement your HTTP function to do whatever you like. But there are still a couple of things you need to know about how requests are received and how you respond to those requests.

Requests
Requests to an HTTP function are passed to the function in the request parameter. The request often contains information the consumer of your API is sending to you. You usually define your API so this information is sent in the path, query, or body.

A function which expects an ID in the path may contain some code like this to retrieve the ID:

Copy
export function get_myFunction(request) {
  // ...

  const id = request.path[0];

  // ...
}
A function which expects an ID in the query string may contain some code like this to retrieve the ID:

Copy
export function get_myFunction(request) {
  // ...

  const id = request.query.id;

  // ...
}
A function which expects an ID in the body may contain some code like this to retrieve the ID:

Copy
export function post_myFunction(request) {  
  
    // ...

    const {id, update} = await request.body.json();

    // ...
}
Sometimes you also want to check the headers sent with the request or the IP address that the request is coming from. See the API Reference for detailed information about the request object.

Responses
To send a response to the caller of your HTTP function, you typically use one of the functions listed below, like ok() or notFound(), to build the most common response types.

For example this GET endpoint searches for an item in a database collection and returns an OK response with the item if it was found or a Not Found response if the requested item does not exist in the collection.

Copy
// In backend/http-functions.js

import { ok, notFound } from "wix-http-functions";
import wixData from "wix-data";

export async function get_myFunction(request) {
  const id = request.path[0];

  const { items } = await wixData.get("MyCollection", id);
  if (items.length > 0) {
    return ok(items[0]);
  } else {
    return notFound({ message: `${id} does not exist` });
  }
}
You can also create a response not covered by the built-in functions using the generic response() function. The responses can contain headers and a body if needed.

The following is a list of the response functions you can use:

Response function	HTTP Status Code	Typical Use
ok( )	200 (OK)	Request was successful.
created( )	201 (Created)	Request was successful and a new resource has been created.
badRequest( )	400 (Bad Request)	Request was unsuccessful because of a client error, such as a request using the incorrect syntax.
forbidden( )	403 (Forbidden)	Request was valid but the server is refusing to process it, usually because the client does not have the necessary permissions for the requested resource.
notFound( )	404 (Not Found)	Requested resource was not found at the current time.
serverError( ) 	500 (Internal Server Error)	Request was unsuccessful because of an unexpected error on the server.
response( )	Any	Response does not fit any of the above scenarios.
Once your response is built, you return it from your HTTP function to send it back to the client that called the function.

Security
When you open up an API to the outside world, keep in mind that you might be exposing sensitive operations and information. For example, you might be allowing consumers of your API to write data to your database collections.

If there are functions that you only want to be called by specific consumers, make sure you authenticate the function caller or use some other means to ensure only authorized parties are able to access information that you don't want everyone to have access to. 

Example
Let's take a look at an example HTTP function to see how it handles requests and returns responses.

This example, handles GET requests which retrieve items from a database collection based on the data sent in the path. The data is encoded as two path parameters. The first parameter is the first name of the user to retrieve and the second is the last name. If the user is not found or there is a problem reaching the database, an appropriate error is returned.

Copy
import { ok, notFound, serverError } from "wix-http-functions";
import wixData from "wix-data";

export function get_myFunction(request) {
  let options = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  const firstName = request.path[0];
  const lastName = request.path[1];

  // query a collection to find matching items
  return (
    wixData
      .query("myUserCollection")
      .eq("firstName", firstName)
      .eq("lastName", lastName)
      .find()
      .then((results) => {
        // matching items were found
        if (results.items.length > 0) {
          options.body = {
            items: results.items,
          };
          return ok(options);
        }
        // no matching items found
        options.body = {
          error: `'${firstName} ${lastName}' was not found`,
        };
        return notFound(options);
      })
      // something went wrong
      .catch((error) => {
        options.body = {
          error: error.message,
        };
        return serverError(options);
      })
  );
}
The code begins by importing several response functions and the data module for performing queries.

Copy
import { ok, notFound, serverError } from "wix-http-functions";
import wixData from "wix-data";
Next, we define the function header so that the function handles GET requests to the myFunction endpoint. 

Copy
export function get_myFunction(request) {
  // Implementation goes here
}
Then, we define some headers that will be used later when we create the proper response.

Copy
let options = {
  headers: {
    "Content-Type": "application/json",
  },
};
After that, we read the path parameters and store them in variables.

Copy
const firstName = request.path[0];
const lastName = request.path[1];
Finally, we query a collection and return the appropriate response. 

If matching items are found, we add the query results to the response body and return an OK response. 
If no matching items are found, we add an error message to the response body and return a Not Found response. 
If there is an error performing the query, we add the error to the response body and return an Internal Server Error response.
Copy
return wixData.query("myUserCollection")
    .eq("firstName", firstName)
    .eq("lastName", lastName)
    .find()
    .then( (results) => {
        // matching items were found
        if(results.items.length > 0) {
            options.body = {
                "items": results.items
            };
            return ok(options);
        }
        // no matching items found
        options.body = {
            "error": `'${firstName} ${lastName}' was not found`
        };
        return notFound(options);
    } )
    // something went wrong
    .catch( (error) => {
        options.body = {
            "error": error
        };
        return serverError(options);
    } );
}
Calling
Once you have an HTTP function, you can test and access it from various endpoints.

Note:

For changes to testing endpoints to take effect, create or deploy a test site.
For changes to production endpoints to take effect, publish your site.
Test endpoints
To test your HTTP functions, create or deploy a test site and call the following endpoints:

For premium sites:
Pattern: https://www.{user\_domain}/\_functions/<functionName>?rc=test-site
Example: https://www.mysite.com/\_functions/myFunction?rc=test-site
For free sites:
Pattern: https://{user\_name}.wixsite.com/{site\_name}/\_functions/<functionName>?rc=test-site
Example: https://user123.wixsite.com/mysite/\_functions/myFunction?rc=test-site
Production endpoints
Publish your site and call the following endpoints:

For premium sites:
Pattern: https://www.{user\_domain}/\_functions/<functionName>
Example: https://www.mysite.com/\_functions/myFunction
For free sites:
Pattern: https://{user\_name}.wixsite.com/{site\_name}/\_functions/<functionName>
Example: https://user123.wixsite.com/mysite/\_functions/myFunction

Give & Get Example - Exposing an API
Let's take a look at an example of an API that we expose from the Give & Get site (template).

We expose an endpoint that our (fictitious) delivery service uses to update our site when a giveaway has been delivered. The delivery service makes an API call to our site letting us know that a giveaway was delivered. When we receive such an API call, we update the status of the giveaway in the Giveaways collection to Delivered.

The code for our HTTP function looks like this:

Copy
import { updateGiveawayStatus } from "backend/giveawaysModule";
import { ok, badRequest } from "wix-http-functions";
import { decryptGiveawayID } from "backend/deliveryServiceHelper";

export async function post_giveawayDelivered(request) {
  const options = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  const encryptedGiveawayID = request.path[0];
  const giveawayID = await decryptGiveawayID(encryptedGiveawayID);

  let response;
  try {
    await updateGiveawayStatus(giveawayID, "Delivered");
    options.body = {
      success: true,
    };

    response = ok(options);
  } catch (error) {
    options.body = {
      success: false,
      errorMessage: error.message,
    };

    response = badRequest(options);
  }

  return response;
}
We begin by importing a function to update a giveaway's status in the Giveaways collection, the HTTP responses that we use, and a function to decrypt IDs. 

Copy
import { updateGiveawayStatus } from "backend/giveawaysModule";
import { ok, badRequest } from "wix-http-functions";
import { decryptGiveawayID } from "backend/deliveryServiceHelper";
Then we declare an HTTP function that handles POST requests to the giveawayDelivered endpoint.

The delivery service will call this endpoint using a URL like this:

.../giveandget/_functions-dev/giveawayDelivered/{giveawayId}

Copy
export async function post_giveawayDelivered(request) {
  // HTTP function implementation goes here
}
Next, we start building the response options by adding the appropriate header.

Copy
const options = {
  headers: {
    "Content-Type": "application/json",
  },
};
After that, we get an encrypted giveaway ID from the request path.

We decrypt the ID using the function we imported above.

We use encrypted IDs to prevent anyone other than the delivery service from updating our site that a delivery has been made. Other users will be able to call our API, but they won't send us the proper IDs, so their calls will have no effect.

Copy
const encryptedGiveawayID = request.path[0];
const giveawayID = await decryptGiveawayID(encryptedGiveawayID);
Finally, we update the status of the specified giveaway to be Delivered.

Assuming the update goes smoothly, we return a 200 OK response and a success flag. If there was some sort of problem we add the error information to the response object and send a 400 Bad Request response.

Copy
let response;
try {
  await updateGiveawayStatus(giveawayID, "Delivered");
  options.body = {
    success: true,
  };

  response = ok(options);
} catch (error) {
  options.body = {
    success: false,
    errorMessage: error.message,
  };

  response = badRequest(options);
}

return response;

Testing and Debugging
In general, testing and debugging in Velo is not any different from testing and debugging any other type of application. But there are a few things you should know that will help you get your code in tip-top shape.

The following tools, described in greater detail below, are available to aid you in the process of writing and maintaining your code:

Developer Console: A console that appears when previewing your site.
Browser Developer Tools: The standard tools of your favorite browser.
Functional Testing: Trigger backend functions to run from the Code Panel.
Site Monitoring: View, collect, and analyze logs generated by your site.
Release Manager: Create versions of your site to test and gradually rollout.
Developer Console
To test and debug your code, preview your site. In preview, you can use the Developer Console at the bottom of the page to see messages you log from your code, system messages, and errors. You can also change the verbosity settings in the console to see additional information about what is happening behind the scenes on your page.

Developer Console

Preview Limitations
In general, previewing your site is the first stop when testing and debugging. For most things it can also be the last stop. However, there are a number of features that cannot be tested in preview.

Here are several examples:

Events that occur in the backend, such as many events fired by Wix Apps, do not fire when previewing your site.
If you have your sandbox collections enabled, preview works with your sandbox data. That means you won't be able test your live data when previewing your site.
When you preview your site, you are assigned the Admin role. That means any code or permissions that are for non-Admin site visitors cannot be tested when previewing your site.
So, what do you do if you need to test things that don't work in preview? Testing on your published site is not ideal and sometimes not even possible. Use the Release Manager instead as described below.

Browser Developer Tools
In some cases, you'll also want to use your browser's developer tools to debug your code. Use the browser's console to see errors that are not caught by the Velo console or to use the browser's debugger. 

Most messages you see in the Velo console are also logged to the browser's console. However, due to security concerns, when viewing the published version of your site, messages logged from the backend are not displayed in the browser console. To see such messages, use Site Monitoring as described below.

To use the browser's debugger, you first need to find the correct source code in the browser. When you preview a page, a message with the name of the file you need to locate is automatically logged in the Developer Console. Use your browser's developer tools to open that file. Once you have it open, you can set breakpoints, watches, and anything else your browser's debugger provides. You can also view the state of your code at any debugger statements you may have added.

Developer Console - Source Files

Functional Testing
You can test backend functions by triggering them in the code panel. You can test regular backend functions, functions in web modules, http functions, and anything else in the backend.

Test the backend function by clicking the green arrow to the left of the function header.

Functional Testing

When you trigger a backend function you specify the values for any parameters that the function expects. You can see the value the function returns and any messages the function logs in the dedicated testing console.

Keep in mind that when you test a backend function it runs in the preview context. So the same limitations you have when previewing your site apply here as well.

Functional Testing Pane

Site Monitoring
The Site Monitoring tool allows you to see events that occur, messages you've logged from code, system messages, and errors. 

Site Monitoring

You can examine live site logs and logs that occur when previewing your site in real time. You can also connect your logs to an external monitoring tool, such as Google Operations, to generate event metrics and perform log analysis. 

You can find the Site Monitoring in the Settings section of your site's dashboard.

Release Manager
The Release Manager allows you to create and publish a test version of your site, called a release candidate, and choose what percentage of traffic is directed to that version of the site. 

Site Monitoring

If you want, you can create a release candidate and set its exposure to 0%. This effectively gives you a published version of your site that nobody but you sees. This "hidden" version is a safe place to test features that do not work in preview. Remember to be careful when using this approach. A release candidate works with the same live data as the main version of your site. So anything you do to the data from the release candidate also effects the main version of your site.