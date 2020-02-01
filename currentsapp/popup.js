document.addEventListener("DOMContentLoaded", function(event) {
    var resultsButton = document.getElementById("getResults");
    resultsButton.onclick = getResults();
});

function getResults(){ alert('Hello World') }